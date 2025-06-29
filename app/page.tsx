'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Upload, FileText, Settings, Download, CheckCircle, AlertTriangle, XCircle, Sparkles, Brain, Search, Edit, Save, X, RotateCcw, Target } from 'lucide-react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

// Types
interface Client {
  ClientID: string
  ClientName: string
  PriorityLevel: number
  RequestedTaskIDs: string[]
  GroupTag: string
  AttributesJSON: any
}

interface Worker {
  WorkerID: string
  WorkerName: string
  Skills: string[]
  AvailableSlots: number[]
  MaxLoadPerPhase: number
  WorkerGroup: string
  QualificationLevel: number
}

interface Task {
  TaskID: string
  TaskName: string
  Category: string
  Duration: number
  RequiredSkills: string[]
  PreferredPhases: number[]
  MaxConcurrent: number
}

interface ValidationError {
  id: string
  type: 'error' | 'warning'
  entityId: string
  field?: string
  message: string
  suggestion?: string
}

interface Rule {
  id: string
  type: string
  name: string
  description: string
  config: any
  active: boolean
}

// Gemini AI Integration
class GeminiAI {
  private apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY

  async generateContent(prompt: string): Promise<string> {
    if (!this.apiKey) {
      console.error('Gemini API key not found. Please set NEXT_PUBLIC_GEMINI_API_KEY in your .env.local file')
      return 'API key not configured'
    }

    try {
      console.log('Making Gemini API request...')
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('Gemini API Error:', response.status, errorText)
        throw new Error(`API request failed: ${response.status} ${errorText}`)
      }
      
      const data = await response.json()
      console.log('Gemini API response:', data)
      
      const result = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!result) {
        console.error('No content in Gemini response:', data)
        throw new Error('No content in API response')
      }
      
      return result
    } catch (error) {
      console.error('Gemini AI Error:', error)
      return 'AI temporarily unavailable'
    }
  }

  async searchData(query: string, data: any): Promise<{results: any[], source: 'ai' | 'local'}> {
    if (!query.trim() || data.length === 0) {
      console.log('Search skipped: empty query or no data')
      return { results: [], source: 'local' }
    }

    console.log('Starting AI search for:', query)
    console.log('Data length:', data.length)

    const prompt = `
    Search this data based on the query: "${query}"
    
    Data: ${JSON.stringify(data.slice(0, 20))}
    
    Return matching items as JSON array. Look for:
    - Text matches in names, categories, skills
    - Numeric comparisons (>, <, =)
    - Skill requirements
    - Phase preferences
    - Priority levels
    - Duration values
    
    Query examples:
    - "tasks with duration > 2"
    - "workers with coding skills"
    - "clients with priority 5"
    - "high priority clients"
    - "short duration tasks"
    
    Return only the matching items as a JSON array. If no matches found, return empty array [].
    `

    try {
      const response = await this.generateContent(prompt)
      console.log('Raw AI response:', response)
      
      if (response === 'API key not configured' || response === 'AI temporarily unavailable') {
        throw new Error(response)
      }
      
      const cleanedResponse = response.replace(/```json|```/g, '').trim()
      console.log('Cleaned response:', cleanedResponse)
      
      // Try to parse the response
      let parsedResults
      try {
        parsedResults = JSON.parse(cleanedResponse)
        console.log('Successfully parsed JSON:', parsedResults)
      } catch (parseError) {
        console.log('JSON parse failed, trying to extract JSON:', parseError)
        // If JSON parsing fails, try to extract JSON from the response
        const jsonMatch = cleanedResponse.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          parsedResults = JSON.parse(jsonMatch[0])
          console.log('Extracted JSON from response:', parsedResults)
        } else {
          throw new Error('No valid JSON found in response')
        }
      }
      
      // Ensure we have an array
      if (Array.isArray(parsedResults)) {
        console.log(`AI search successful: found ${parsedResults.length} results`)
        return { results: parsedResults.slice(0, 20), source: 'ai' } // Limit results
      } else {
        throw new Error('Response is not an array')
      }
    } catch (error) {
      console.error('AI search failed, falling back to local search:', error)
      // Fallback to local search
      const localResults = data.filter((item: any) => {
        const searchLower = query.toLowerCase()
        const itemString = JSON.stringify(item).toLowerCase()
        return itemString.includes(searchLower)
      }).slice(0, 20)
      
      console.log(`Local search found ${localResults.length} results`)
      return { results: localResults, source: 'local' }
    }
  }

  async convertToRule(description: string): Promise<Rule> {
    const prompt = `
    Convert this business rule description to a structured rule:
    "${description}"
    
    Return JSON with:
    {
      "type": "coRun|loadLimit|phaseWindow|slotRestriction",
      "name": "rule name",
      "description": "clear description", 
      "config": "rule configuration"
    }
    
    Examples:
    - "Tasks T1 and T2 should run together" → coRun rule
    - "GroupA workers max 2 tasks per phase" → loadLimit rule
    `

    try {
      const response = await this.generateContent(prompt)
      const parsed = JSON.parse(response.replace(/```json|```/g, ''))
      return {
        id: `rule-${Date.now()}`,
        ...parsed,
        active: true
      }
    } catch {
      return {
        id: `rule-${Date.now()}`,
        type: 'custom',
        name: 'Custom Rule',
        description,
        config: {},
        active: true
      }
    }
  }

  async suggestCorrections(errors: ValidationError[]): Promise<any[]> {
    if (errors.length === 0) return []

    const prompt = `
    Suggest corrections for these data errors. Analyze ALL errors and provide fixes for each one:
    ${JSON.stringify(errors)}
    
    Return JSON array with corrections for ALL errors. Each correction should have:
    {
      "entityId": "ID",
      "field": "field name", 
      "currentValue": "current value",
      "suggestedValue": "suggested fix",
      "reason": "why this fix"
    }
    
    Error Type Guidelines:
    - Duplicate IDs: Suggest unique alternatives (e.g., C1 → C1_updated)
    - Invalid Priority/Qualification: Suggest values between 1-5
    - Unknown Task IDs: Suggest removing invalid IDs or valid alternatives
    - Invalid Duration: Suggest positive numbers
    - Missing Skills: Suggest common skills or empty array
    - Invalid Arrays: Suggest proper array format
    
    Important:
    - Provide fixes for ALL ${errors.length} errors, not just some
    - Each error must have exactly one correction
    - Return exactly ${errors.length} corrections
    - Make suggestions practical and actionable
    `

    try {
      const response = await this.generateContent(prompt)
      const cleanedResponse = response.replace(/```json|```/g, '').trim()
      
      // Try to parse the response
      let parsedResults
      try {
        parsedResults = JSON.parse(cleanedResponse)
      } catch {
        // If JSON parsing fails, try to extract JSON from the response
        const jsonMatch = cleanedResponse.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          parsedResults = JSON.parse(jsonMatch[0])
        } else {
          throw new Error('No valid JSON found in response')
        }
      }
      
      // Ensure we have an array and it has the expected number of corrections
      if (Array.isArray(parsedResults)) {
        console.log(`AI generated ${parsedResults.length} fixes for ${errors.length} errors`)
        return parsedResults
      } else {
        throw new Error('Response is not an array')
      }
    } catch (error) {
      console.error('AI corrections failed:', error)
      // Fallback: generate basic corrections for all errors
      return errors.map(error => ({
        entityId: error.entityId,
        field: error.field || 'unknown',
        currentValue: 'unknown',
        suggestedValue: error.suggestion || 'Fix manually',
        reason: error.message
      }))
    }
  }
}

const geminiAI = new GeminiAI()

// Data parsing utilities
function parseCSV(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (error) => reject(error)
    })
  })
}

function parseExcel(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const worksheet = workbook.Sheets[workbook.SheetNames[0]]
        const jsonData = XLSX.utils.sheet_to_json(worksheet)
        resolve(jsonData)
      } catch (error) {
        reject(error)
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

function normalizeData(rawData: any[], type: 'clients' | 'workers' | 'tasks') {
  return rawData.map((row, index) => {
    if (type === 'clients') {
      return {
        ClientID: String(row.ClientID || `C${index + 1}`),
        ClientName: String(row.ClientName || 'Unknown'),
        PriorityLevel: parseInt(row.PriorityLevel || '1'),
        RequestedTaskIDs: (row.RequestedTaskIDs || '').split(',').map((s: string) => s.trim()).filter(Boolean),
        GroupTag: String(row.GroupTag || 'Default'),
        AttributesJSON: typeof row.AttributesJSON === 'string' ? 
          (() => { try { return JSON.parse(row.AttributesJSON) } catch { return {} } })() : 
          (row.AttributesJSON || {})
      }
    } else if (type === 'workers') {
      return {
        WorkerID: String(row.WorkerID || `W${index + 1}`),
        WorkerName: String(row.WorkerName || 'Unknown'),
        Skills: (row.Skills || '').split(',').map((s: string) => s.trim()).filter(Boolean),
        AvailableSlots: parseSlots(row.AvailableSlots || '[]'),
        MaxLoadPerPhase: parseInt(row.MaxLoadPerPhase || '1'),
        WorkerGroup: String(row.WorkerGroup || 'Default'),
        QualificationLevel: parseInt(row.QualificationLevel || '1')
      }
    } else {
      return {
        TaskID: String(row.TaskID || `T${index + 1}`),
        TaskName: String(row.TaskName || 'Unknown'),
        Category: String(row.Category || 'General'),
        Duration: parseInt(row.Duration || '1'),
        RequiredSkills: (row.RequiredSkills || '').split(',').map((s: string) => s.trim()).filter(Boolean),
        PreferredPhases: parsePhases(row.PreferredPhases || '[]'),
        MaxConcurrent: parseInt(row.MaxConcurrent || '1')
      }
    }
  })
}

function parseSlots(slotsString: string): number[] {
  if (slotsString.startsWith('[') && slotsString.endsWith(']')) {
    try {
      return JSON.parse(slotsString)
    } catch {
      return []
    }
  }
  return slotsString.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
}

function parsePhases(phasesString: string): number[] {
  if (phasesString.includes('-')) {
    const [start, end] = phasesString.split('-').map(s => parseInt(s.trim()))
    const result = []
    for (let i = start; i <= end; i++) {
      result.push(i)
    }
    return result
  }
  return parseSlots(phasesString)
}

// Validation
function validateData(clients: Client[], workers: Worker[], tasks: Task[]): ValidationError[] {
  const errors: ValidationError[] = []
  
  // Check duplicate IDs
  const clientIds = new Set()
  clients.forEach(client => {
    if (clientIds.has(client.ClientID)) {
      errors.push({
        id: `dup-client-${client.ClientID}`,
        type: 'error',
        entityId: client.ClientID,
        field: 'ClientID',
        message: `Duplicate Client ID: ${client.ClientID}`,
        suggestion: 'Use unique IDs for each client'
      })
    }
    clientIds.add(client.ClientID)
    
    // Validate priority level
    if (client.PriorityLevel < 1 || client.PriorityLevel > 5) {
      errors.push({
        id: `priority-${client.ClientID}`,
        type: 'error',
        entityId: client.ClientID,
        field: 'PriorityLevel',
        message: `Priority must be 1-5, got ${client.PriorityLevel}`,
        suggestion: 'Set priority between 1 and 5'
      })
    }
  })

  // Check task references
  const taskIds = new Set(tasks.map(t => t.TaskID))
  clients.forEach(client => {
    // Ensure RequestedTaskIDs is an array
    let requestedTaskIds: string[] = []
    if (Array.isArray(client.RequestedTaskIDs)) {
      requestedTaskIds = client.RequestedTaskIDs
    } else if (typeof client.RequestedTaskIDs === 'string') {
      requestedTaskIds = (client.RequestedTaskIDs as string).split(',').map((s: string) => s.trim()).filter(Boolean)
    }
    
    requestedTaskIds.forEach((taskId: string) => {
      if (!taskIds.has(taskId)) {
        errors.push({
          id: `unknown-task-${client.ClientID}-${taskId}`,
          type: 'error',
          entityId: client.ClientID,
          field: 'RequestedTaskIDs',
          message: `Unknown task ID: ${taskId}`,
          suggestion: 'Remove invalid task ID or add corresponding task'
        })
      }
    })
  })

  // Validate workers
  const workerIds = new Set()
  workers.forEach(worker => {
    if (workerIds.has(worker.WorkerID)) {
      errors.push({
        id: `dup-worker-${worker.WorkerID}`,
        type: 'error',
        entityId: worker.WorkerID,
        field: 'WorkerID',
        message: `Duplicate Worker ID: ${worker.WorkerID}`,
        suggestion: 'Use unique IDs for each worker'
      })
    }
    workerIds.add(worker.WorkerID)
    
    if (worker.QualificationLevel < 1 || worker.QualificationLevel > 5) {
      errors.push({
        id: `qual-${worker.WorkerID}`,
        type: 'error',
        entityId: worker.WorkerID,
        field: 'QualificationLevel',
        message: `Qualification must be 1-5, got ${worker.QualificationLevel}`,
        suggestion: 'Set qualification between 1 and 5'
      })
    }
  })

  // Validate tasks
  tasks.forEach(task => {
    if (task.Duration < 1) {
      errors.push({
        id: `duration-${task.TaskID}`,
        type: 'error',
        entityId: task.TaskID,
        field: 'Duration',
        message: `Duration must be at least 1, got ${task.Duration}`,
        suggestion: 'Set duration to positive number'
      })
    }
  })

  return errors
}

// Main Component
export default function DataAlchemist() {
  const [activeTab, setActiveTab] = useState('upload')
  const [dataTab, setDataTab] = useState('clients')
  const [clients, setClients] = useState<Client[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [editingCell, setEditingCell] = useState<{entityId: string, field: string, value: any} | null>(null)
  const [ruleDescription, setRuleDescription] = useState('')
  const [aiCorrections, setAiCorrections] = useState<any[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [isGeneratingFixes, setIsGeneratingFixes] = useState(false)
  const [showFixesSuccess, setShowFixesSuccess] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState<'checking' | 'missing' | 'valid' | 'error'>('checking')
  const [searchSource, setSearchSource] = useState<'ai' | 'local' | null>(null)
  
  // Priority weights
  const [priorityWeights, setPriorityWeights] = useState({
    priorityLevel: 30,
    taskFulfillment: 25,
    fairness: 20,
    workloadBalance: 15,
    skillMatch: 10
  })

  const fileInputRefs = {
    clients: useRef<HTMLInputElement>(null),
    workers: useRef<HTMLInputElement>(null),
    tasks: useRef<HTMLInputElement>(null)
  }

  // Check API key status on component mount
  useEffect(() => {
    const checkApiKey = () => {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY
      if (!apiKey) {
        setApiKeyStatus('missing')
      } else {
        setApiKeyStatus('valid')
      }
    }
    checkApiKey()
  }, [])

  const handleFileUpload = useCallback(async (file: File, type: 'clients' | 'workers' | 'tasks') => {
    setIsProcessing(true)
    try {
      const extension = file.name.split('.').pop()?.toLowerCase()
      let rawData: any[]
      
      if (extension === 'csv') {
        rawData = await parseCSV(file)
      } else if (extension === 'xlsx' || extension === 'xls') {
        rawData = await parseExcel(file)
      } else {
        throw new Error('Unsupported file format')
      }

      const normalizedData = normalizeData(rawData, type)
      
      if (type === 'clients') setClients(normalizedData as Client[])
      else if (type === 'workers') setWorkers(normalizedData as Worker[])
      else setTasks(normalizedData as Task[])
      
      // Run validation
      setTimeout(() => {
        const newErrors = validateData(
          type === 'clients' ? normalizedData as Client[] : clients,
          type === 'workers' ? normalizedData as Worker[] : workers,
          type === 'tasks' ? normalizedData as Task[] : tasks
        )
        setErrors(newErrors)
        setIsProcessing(false)
      }, 1000)
      
    } catch (error) {
      console.error('Upload error:', error)
      setIsProcessing(false)
    }
  }, [clients, workers, tasks])

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      setSearchSource(null)
      return
    }
    
    setIsSearching(true)
    try {
      const allData = [...clients, ...workers, ...tasks]
      const results = await geminiAI.searchData(searchQuery, allData)
      setSearchResults(results.results)
      setSearchSource(results.source)
    } catch (error) {
      console.error('Search error:', error)
      setSearchResults([])
      setSearchSource(null)
    } finally {
      setIsSearching(false)
    }
  }

  // Real-time search with debouncing
  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    
    if (!value.trim()) {
      setSearchResults([])
      setSearchSource(null)
      return
    }
    
    // Enhanced local search for immediate feedback
    const allData = [...clients, ...workers, ...tasks]
    console.log('Local search - data length:', allData.length)
    console.log('Search query:', value)
    
    const localResults = allData.filter((item: any) => {
      const searchLower = value.toLowerCase()
      const itemString = JSON.stringify(item).toLowerCase()
      
      // Basic text search
      if (itemString.includes(searchLower)) {
        return true
      }
      
      // Handle numeric comparisons for tasks
      if (item.TaskID && item.Duration !== undefined) {
        // Check for "duration > X" pattern
        const durationMatch = searchLower.match(/duration\s*([><=])\s*(\d+)/)
        if (durationMatch) {
          const operator = durationMatch[1]
          const value = parseInt(durationMatch[2])
          const duration = parseInt(item.Duration)
          
          switch (operator) {
            case '>':
              return duration > value
            case '<':
              return duration < value
            case '=':
              return duration === value
            default:
              return false
          }
        }
      }
      
      // Handle priority searches for clients
      if (item.ClientID && item.PriorityLevel !== undefined) {
        const priorityMatch = searchLower.match(/priority\s*([><=])\s*(\d+)/)
        if (priorityMatch) {
          const operator = priorityMatch[1]
          const value = parseInt(priorityMatch[2])
          const priority = parseInt(item.PriorityLevel)
          
          switch (operator) {
            case '>':
              return priority > value
            case '<':
              return priority < value
            case '=':
              return priority === value
            default:
              return false
          }
        }
      }
      
      // Handle skill searches for workers
      if (item.WorkerID && Array.isArray(item.Skills)) {
        const skillMatch = searchLower.match(/skills?\s+(.+)/)
        if (skillMatch) {
          const requiredSkill = skillMatch[1].trim()
          return item.Skills.some((skill: string) => 
            skill.toLowerCase().includes(requiredSkill)
          )
        }
      }
      
      // Handle skill searches for tasks
      if (item.TaskID && Array.isArray(item.RequiredSkills)) {
        const skillMatch = searchLower.match(/skills?\s+(.+)/)
        if (skillMatch) {
          const requiredSkill = skillMatch[1].trim()
          return item.RequiredSkills.some((skill: string) => 
            skill.toLowerCase().includes(requiredSkill)
          )
        }
      }
      
      return false
    }).slice(0, 10) // Limit to 10 results for performance
    
    console.log('Local search results:', localResults.length)
    setSearchResults(localResults)
    setSearchSource('local')
  }

  const clearSearch = () => {
    setSearchQuery('')
    setSearchResults([])
    setSearchSource(null)
  }

  const loadSampleData = async () => {
    setIsProcessing(true)
    try {
      // Load sample CSV files
      const [clientsResponse, workersResponse, tasksResponse] = await Promise.all([
        fetch('/samples/clients.csv'),
        fetch('/samples/workers.csv'),
        fetch('/samples/tasks.csv')
      ])
      
      const clientsText = await clientsResponse.text()
      const workersText = await workersResponse.text()
      const tasksText = await tasksResponse.text()
      
      // Parse CSV data
      const clientsData = Papa.parse(clientsText, { header: true }).data
      const workersData = Papa.parse(workersText, { header: true }).data
      const tasksData = Papa.parse(tasksText, { header: true }).data
      
      // Normalize data
      const normalizedClients = normalizeData(clientsData, 'clients')
      const normalizedWorkers = normalizeData(workersData, 'workers')
      const normalizedTasks = normalizeData(tasksData, 'tasks')
      
      // Set data
      setClients(normalizedClients as Client[])
      setWorkers(normalizedWorkers as Worker[])
      setTasks(normalizedTasks as Task[])
      
      // Run validation
      setTimeout(() => {
        const newErrors = validateData(normalizedClients as Client[], normalizedWorkers as Worker[], normalizedTasks as Task[])
        setErrors(newErrors)
        setIsProcessing(false)
      }, 1000)
      
    } catch (error) {
      console.error('Error loading sample data:', error)
      setIsProcessing(false)
    }
  }

  const handleCreateRule = async () => {
    if (!ruleDescription.trim()) return
    
    const rule = await geminiAI.convertToRule(ruleDescription)
    setRules([...rules, rule])
    setRuleDescription('')
  }

  const generateAICorrections = async () => {
    setIsGeneratingFixes(true)
    setShowFixesSuccess(false)
    try {
      const corrections = await geminiAI.suggestCorrections(errors)
      setAiCorrections(corrections)
      setShowFixesSuccess(true)
      // Auto-hide success message after 3 seconds
      setTimeout(() => setShowFixesSuccess(false), 3000)
    } catch (error) {
      console.error('AI corrections error:', error)
      setAiCorrections([])
    } finally {
      setIsGeneratingFixes(false)
    }
  }

  const applyCorrection = (correction: any) => {
    // Helper function to normalize field values based on field type
    const normalizeFieldValue = (field: string, value: any) => {
      if (field === 'RequestedTaskIDs') {
        if (Array.isArray(value)) return value
        if (typeof value === 'string') {
          return value.split(',').map((s: string) => s.trim()).filter(Boolean)
        }
        return []
      }
      if (field === 'Skills' || field === 'RequiredSkills') {
        if (Array.isArray(value)) return value
        if (typeof value === 'string') {
          return value.split(',').map((s: string) => s.trim()).filter(Boolean)
        }
        return []
      }
      if (field === 'AvailableSlots' || field === 'PreferredPhases') {
        if (Array.isArray(value)) return value
        if (typeof value === 'string') {
          try {
            return JSON.parse(value)
          } catch {
            return value.split(',').map((s: string) => parseInt(s.trim())).filter(n => !isNaN(n))
          }
        }
        return []
      }
      return value
    }

    // Apply the correction to the data
    if (clients.find(c => c.ClientID === correction.entityId)) {
      setClients(clients.map(c => 
        c.ClientID === correction.entityId 
          ? { ...c, [correction.field]: normalizeFieldValue(correction.field, correction.suggestedValue) }
          : c
      ))
    } else if (workers.find(w => w.WorkerID === correction.entityId)) {
      setWorkers(workers.map(w => 
        w.WorkerID === correction.entityId 
          ? { ...w, [correction.field]: normalizeFieldValue(correction.field, correction.suggestedValue) }
          : w
      ))
    } else if (tasks.find(t => t.TaskID === correction.entityId)) {
      setTasks(tasks.map(t => 
        t.TaskID === correction.entityId 
          ? { ...t, [correction.field]: normalizeFieldValue(correction.field, correction.suggestedValue) }
          : t
      ))
    }
    
    // Re-run validation
    const newErrors = validateData(clients, workers, tasks)
    setErrors(newErrors)
  }

  const handleCellEdit = (entityId: string, field: string, newValue: any) => {
    // Helper function to normalize field values based on field type
    const normalizeFieldValue = (field: string, value: any) => {
      if (field === 'RequestedTaskIDs') {
        if (Array.isArray(value)) return value
        if (typeof value === 'string') {
          return value.split(',').map((s: string) => s.trim()).filter(Boolean)
        }
        return []
      }
      if (field === 'Skills' || field === 'RequiredSkills') {
        if (Array.isArray(value)) return value
        if (typeof value === 'string') {
          return value.split(',').map((s: string) => s.trim()).filter(Boolean)
        }
        return []
      }
      if (field === 'AvailableSlots' || field === 'PreferredPhases') {
        if (Array.isArray(value)) return value
        if (typeof value === 'string') {
          try {
            return JSON.parse(value)
          } catch {
            return value.split(',').map((s: string) => parseInt(s.trim())).filter(n => !isNaN(n))
          }
        }
        return []
      }
      if (field === 'PriorityLevel' || field === 'QualificationLevel' || field === 'Duration' || field === 'MaxLoadPerPhase' || field === 'MaxConcurrent') {
        const numValue = parseInt(value)
        return isNaN(numValue) ? 1 : numValue
      }
      return value
    }

    // Apply the edit to the data
    if (clients.find(c => c.ClientID === entityId)) {
      setClients(clients.map(c => 
        c.ClientID === entityId 
          ? { ...c, [field]: normalizeFieldValue(field, newValue) }
          : c
      ))
    } else if (workers.find(w => w.WorkerID === entityId)) {
      setWorkers(workers.map(w => 
        w.WorkerID === entityId 
          ? { ...w, [field]: normalizeFieldValue(field, newValue) }
          : w
      ))
    } else if (tasks.find(t => t.TaskID === entityId)) {
      setTasks(tasks.map(t => 
        t.TaskID === entityId 
          ? { ...t, [field]: normalizeFieldValue(field, newValue) }
          : t
      ))
    }
    
    // Re-run validation
    setTimeout(() => {
      const newErrors = validateData(clients, workers, tasks)
      setErrors(newErrors)
    }, 100)
    
    setEditingCell(null)
  }

  const exportData = () => {
    // Create Excel workbook
    const workbook = XLSX.utils.book_new()
    
    // Add data sheets
    const clientsSheet = XLSX.utils.json_to_sheet(clients.map(c => ({
      ...c,
      RequestedTaskIDs: c.RequestedTaskIDs.join(','),
      AttributesJSON: JSON.stringify(c.AttributesJSON)
    })))
    XLSX.utils.book_append_sheet(workbook, clientsSheet, 'Clients')
    
    const workersSheet = XLSX.utils.json_to_sheet(workers.map(w => ({
      ...w,
      Skills: w.Skills.join(','),
      AvailableSlots: JSON.stringify(w.AvailableSlots)
    })))
    XLSX.utils.book_append_sheet(workbook, workersSheet, 'Workers')
    
    const tasksSheet = XLSX.utils.json_to_sheet(tasks.map(t => ({
      ...t,
      RequiredSkills: t.RequiredSkills.join(','),
      PreferredPhases: JSON.stringify(t.PreferredPhases)
    })))
    XLSX.utils.book_append_sheet(workbook, tasksSheet, 'Tasks')
    
    // Download
    XLSX.writeFile(workbook, 'data-alchemist-export.xlsx')
    
    // Export rules
    const rulesBlob = new Blob([JSON.stringify({ rules, priorityWeights }, null, 2)], 
      { type: 'application/json' })
    const rulesUrl = URL.createObjectURL(rulesBlob)
    const rulesLink = document.createElement('a')
    rulesLink.href = rulesUrl
    rulesLink.download = 'rules-config.json'
    rulesLink.click()
  }

  const totalRecords = clients.length + workers.length + tasks.length
  const errorCount = errors.filter(e => e.type === 'error').length
  const warningCount = errors.filter(e => e.type === 'warning').length

  // Better data quality calculation
  const calculateDataQuality = () => {
    if (totalRecords === 0) return 100
    
    // Calculate quality based on valid records vs total records
    const validRecords = totalRecords - errorCount
    const baseQuality = Math.max(0, (validRecords / totalRecords) * 100)
    
    // Apply penalty for warnings (smaller impact than errors)
    const warningPenalty = (warningCount / totalRecords) * 10
    
    // Ensure quality is between 0 and 100
    return Math.max(0, Math.min(100, Math.round(baseQuality - warningPenalty)))
  }

  const dataQuality = calculateDataQuality()

  // Helper function to get data quality color and status
  const getDataQualityInfo = (quality: number) => {
    if (quality >= 90) return { color: 'text-green-600', status: 'Excellent' }
    if (quality >= 75) return { color: 'text-blue-600', status: 'Good' }
    if (quality >= 50) return { color: 'text-yellow-600', status: 'Fair' }
    if (quality >= 25) return { color: 'text-orange-600', status: 'Poor' }
    return { color: 'text-red-600', status: 'Critical' }
  }

  const qualityInfo = getDataQualityInfo(dataQuality)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Data Alchemist</h1>
              <p className="text-sm text-gray-600">AI Resource Allocation Configurator</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${errorCount > 0 ? 'bg-red-500' : warningCount > 0 ? 'bg-yellow-500' : 'bg-green-500'}`} />
              <span className="text-sm font-medium">
                {errorCount > 0 ? 'Has Errors' : warningCount > 0 ? 'Has Warnings' : 'All Valid'}
              </span>
            </div>
            {isProcessing && (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
                <span className="text-sm text-gray-600">Processing...</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      {totalRecords > 0 && (
        <div className="px-6 py-4 bg-white border-b border-gray-200">
          <div className="grid grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{clients.length}</div>
              <div className="text-sm text-gray-600">Clients</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{workers.length}</div>
              <div className="text-sm text-gray-600">Workers</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{tasks.length}</div>
              <div className="text-sm text-gray-600">Tasks</div>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="px-6 py-4 bg-white border-b border-gray-200">
        <div className="flex space-x-1">
          {[
            { id: 'upload', label: 'Upload', icon: Upload },
            { id: 'data', label: 'Data', icon: FileText, disabled: totalRecords === 0 },
            { id: 'rules', label: 'Rules', icon: Settings, disabled: totalRecords === 0 },
            { id: 'validate', label: 'Validate', icon: errorCount > 0 ? XCircle : warningCount > 0 ? AlertTriangle : CheckCircle, disabled: totalRecords === 0 },
            { id: 'export', label: 'Export', icon: Download, disabled: totalRecords === 0 || errorCount > 0 }
          ].map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => !tab.disabled && setActiveTab(tab.id)}
                className={`tab-button ${activeTab === tab.id ? 'active' : ''} ${tab.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={tab.disabled}
              >
                <Icon className="w-4 h-4 inline mr-2" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === 'upload' && (
          <div className="space-y-6">
            <div className="text-center">
              <Brain className="w-12 h-12 mx-auto mb-4 text-blue-500" />
              <h2 className="text-2xl font-bold mb-2">Gemini AI-Powered Data Ingestion</h2>
              <p className="text-gray-600 max-w-2xl mx-auto">
                Upload your CSV or Excel files and let AI intelligently parse and validate your data
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { key: 'clients', title: 'Clients Data', desc: 'Client information, priorities, and task requests' },
                { key: 'workers', title: 'Workers Data', desc: 'Worker skills, availability, and qualifications' },
                { key: 'tasks', title: 'Tasks Data', desc: 'Task definitions, requirements, and constraints' }
              ].map(item => (
                <div key={item.key} className="card">
                  <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-gray-600 mb-4">{item.desc}</p>
                  
                  <div 
                    className="upload-zone"
                    onClick={() => fileInputRefs[item.key as keyof typeof fileInputRefs].current?.click()}
                  >
                    <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <div className="text-sm text-gray-600">Click to upload CSV/Excel</div>
                    <input
                      ref={fileInputRefs[item.key as keyof typeof fileInputRefs]}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleFileUpload(file, item.key as any)
                      }}
                      className="hidden"
                    />
                  </div>
                  
                  {(item.key === 'clients' && clients.length > 0) ||
                   (item.key === 'workers' && workers.length > 0) ||
                   (item.key === 'tasks' && tasks.length > 0) ? (
                    <div className="mt-4 p-3 bg-green-50 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span className="text-sm font-medium text-green-700">
                          {item.key === 'clients' ? clients.length :
                           item.key === 'workers' ? workers.length : tasks.length} records loaded
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'data' && (
          <div className="space-y-6">
            {/* AI Search */}
            <div className="card">
              <div className="flex items-center space-x-2 mb-4">
                <Sparkles className="w-5 h-5 text-purple-500" />
                <h3 className="text-lg font-semibold">AI-Powered Search</h3>
                {apiKeyStatus === 'missing' && (
                  <span className="badge badge-warning text-xs">API Key Missing</span>
                )}
              </div>
              
              {apiKeyStatus === 'missing' && (
                <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-yellow-800">Gemini API Key Required</h4>
                      <p className="text-sm text-yellow-700 mt-1">
                        To use AI-powered search, you need to set up your Gemini API key.
                      </p>
                      <div className="mt-2 text-xs text-yellow-600">
                        <p>1. Get your API key from <a href="https://makersuite.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="underline">Google AI Studio</a></p>
                        <p>2. Create a <code className="bg-yellow-100 px-1 rounded">.env.local</code> file in your project root</p>
                        <p>3. Add: <code className="bg-yellow-100 px-1 rounded">NEXT_PUBLIC_GEMINI_API_KEY=your_api_key_here</code></p>
                        <p>4. Restart your development server</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="flex space-x-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder={apiKeyStatus === 'missing' ? "API key required for AI search" : "Search with natural language... e.g., 'tasks with duration > 2'"}
                    className={`w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                      apiKeyStatus === 'missing' ? 'bg-gray-100 cursor-not-allowed' : ''
                    }`}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    disabled={apiKeyStatus === 'missing'}
                  />
                </div>
                <button 
                  onClick={handleSearch} 
                  className={`button ${apiKeyStatus === 'missing' ? 'bg-gray-300 cursor-not-allowed' : 'button-primary'}`} 
                  disabled={isSearching || apiKeyStatus === 'missing'}
                >
                  {isSearching ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      Searching...
                    </>
                  ) : (
                    'AI Search'
                  )}
                </button>
                {searchQuery && (
                  <button onClick={clearSearch} className="button bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg">
                    Clear
                  </button>
                )}
              </div>
              
              {apiKeyStatus === 'missing' && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <span className="text-sm text-blue-700">
                      Local search is still available - try typing in the search box above
                    </span>
                  </div>
                </div>
              )}
              
              {totalRecords === 0 && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg text-center">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                  <p className="text-sm text-gray-600">No data loaded yet</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Upload your data files or load sample data to start searching
                  </p>
                  <button 
                    onClick={loadSampleData}
                    disabled={isProcessing}
                    className="mt-3 button button-primary text-sm"
                  >
                    {isProcessing ? 'Loading...' : 'Load Sample Data'}
                  </button>
                </div>
              )}
              
              {searchResults.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium">Search Results ({searchResults.length})</div>
                    <div className="flex items-center space-x-2">
                      {searchSource === 'ai' && (
                        <div className="flex items-center space-x-1 text-xs text-purple-600">
                          <Sparkles className="w-3 h-3" />
                          <span>AI Search</span>
                        </div>
                      )}
                      {searchSource === 'local' && (
                        <div className="flex items-center space-x-1 text-xs text-blue-600">
                          <Search className="w-3 h-3" />
                          <span>Local Search</span>
                        </div>
                      )}
                      <div className="text-xs text-gray-500">
                        {searchQuery.length > 0 && searchQuery.length < 3 ? 'Type more for better results' : 'Showing best matches'}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto border rounded-lg p-2">
                    {searchResults.map((result, index) => {
                      const type = result.ClientID ? 'Client' : result.WorkerID ? 'Worker' : 'Task'
                      const id = result.ClientID || result.WorkerID || result.TaskID
                      const name = result.ClientName || result.WorkerName || result.TaskName
                      
                      return (
                        <div key={index} className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="badge badge-secondary text-xs">{type}</span>
                                <strong className="text-sm">{id}</strong>
                              </div>
                              <div className="text-sm text-gray-700 mt-1">{name}</div>
                              {type === 'Client' && (
                                <div className="text-xs text-gray-500 mt-1">
                                  Priority: {result.PriorityLevel} | Tasks: {Array.isArray(result.RequestedTaskIDs) ? result.RequestedTaskIDs.length : 0}
                                </div>
                              )}
                              {type === 'Worker' && (
                                <div className="text-xs text-gray-500 mt-1">
                                  Skills: {Array.isArray(result.Skills) ? result.Skills.slice(0, 3).join(', ') : 'None'} | Level: {result.QualificationLevel}
                                </div>
                              )}
                              {type === 'Task' && (
                                <div className="text-xs text-gray-500 mt-1">
                                  Duration: {result.Duration} | Category: {result.Category} | Skills: {Array.isArray(result.RequiredSkills) ? result.RequiredSkills.slice(0, 2).join(', ') : 'None'}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              
              {searchQuery && searchResults.length === 0 && !isSearching && totalRecords > 0 && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg text-center">
                  <Search className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                  <p className="text-sm text-gray-600">No results found for "{searchQuery}"</p>
                  <p className="text-xs text-gray-500 mt-1">Try different keywords or use the AI Search for more advanced queries</p>
                </div>
              )}
              
              {searchQuery && !searchQuery.trim() && searchResults.length > 0 && (
                <div className="mt-4 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <span className="text-xs text-blue-700">
                      Showing all data - type to search
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Data Tables */}
            <div className="space-y-6">
              {/* Data Category Tabs */}
              <div className="card">
                <div className="flex space-x-1 mb-4">
                  {[
                    { id: 'clients', label: 'Clients', count: clients.length, icon: '👥' },
                    { id: 'workers', label: 'Workers', count: workers.length, icon: '👷' },
                    { id: 'tasks', label: 'Tasks', count: tasks.length, icon: '📋' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setDataTab(tab.id)}
                      className={`flex-1 py-3 px-4 rounded-lg font-medium transition-colors ${
                        dataTab === tab.id
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-center space-x-2">
                        <span className="text-lg">{tab.icon}</span>
                        <span>{tab.label}</span>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          dataTab === tab.id ? 'bg-white bg-opacity-20' : 'bg-gray-200'
                        }`}>
                          {tab.count}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Data Table */}
                {(() => {
                  const currentData = dataTab === 'clients' ? clients : dataTab === 'workers' ? workers : tasks
                  const currentKey = dataTab === 'clients' ? 'ClientID' : dataTab === 'workers' ? 'WorkerID' : 'TaskID'
                  const currentTitle = dataTab === 'clients' ? 'Clients' : dataTab === 'workers' ? 'Workers' : 'Tasks'
                  
                  return (
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">{currentTitle} Data ({currentData.length} records)</h3>
                        {currentData.length > 0 && (
                          <div className="text-sm text-gray-500">
                            Showing all {currentData.length} records
                          </div>
                        )}
                      </div>
                      
                      {currentData.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse border border-gray-300">
                            <thead>
                              <tr className="bg-gray-50">
                                {Object.keys(currentData[0]).map(key => (
                                  <th key={key} className="border border-gray-300 px-3 py-2 text-left text-sm font-medium text-gray-700">
                                    {key}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {currentData.map((row: any, index: number) => (
                                <tr key={row[currentKey]} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                  {Object.entries(row).map(([key, value]) => {
                                    const hasError = errors.some(e => 
                                      e.entityId === row[currentKey] && e.field === key
                                    )
                                    return (
                                      <td 
                                        key={key} 
                                        className={`border border-gray-300 px-3 py-2 text-sm ${
                                          hasError ? 'bg-red-50 border-red-300' : ''
                                        }`}
                                        onClick={() => setEditingCell({ entityId: row[currentKey], field: key, value })}
                                      >
                                        {editingCell?.entityId === row[currentKey] && editingCell?.field === key ? (
                                          <div className="flex items-center space-x-2">
                                            <input
                                              type="text"
                                              value={editingCell.value}
                                              onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                              className="flex-1 px-2 py-1 border rounded text-sm"
                                              autoFocus
                                              onKeyPress={(e) => {
                                                if (e.key === 'Enter') {
                                                  handleCellEdit(row[currentKey], key, editingCell.value)
                                                }
                                              }}
                                            />
                                            <button 
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                handleCellEdit(row[currentKey], key, editingCell.value)
                                              }}
                                              className="p-1 text-green-600 hover:bg-green-50 rounded"
                                            >
                                              <Save className="w-3 h-3" />
                                            </button>
                                            <button 
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                setEditingCell(null)
                                              }}
                                              className="p-1 text-red-600 hover:bg-red-50 rounded"
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="group cursor-pointer">
                                            <div className="truncate max-w-xs">
                                              {Array.isArray(value) ? value.join(', ') : 
                                               typeof value === 'object' ? JSON.stringify(value) : 
                                               String(value)}
                                            </div>
                                            <Edit className="w-3 h-3 opacity-0 group-hover:opacity-100 inline ml-2" />
                                          </div>
                                        )}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-center py-12 text-gray-500">
                          <div className="text-4xl mb-4">
                            {dataTab === 'clients' ? '👥' : dataTab === 'workers' ? '👷' : '📋'}
                          </div>
                          <p className="text-lg font-medium">No {currentTitle.toLowerCase()} data uploaded yet</p>
                          <p className="text-sm mt-2">Upload your {currentTitle.toLowerCase()} data file to get started</p>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'rules' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Rule Builder */}
              <div className="card">
                <div className="flex items-center space-x-2 mb-4">
                  <Sparkles className="w-5 h-5 text-blue-500" />
                  <h3 className="text-lg font-semibold">AI Rule Builder</h3>
                </div>
                <div className="space-y-4">
                  <textarea
                    value={ruleDescription}
                    onChange={(e) => setRuleDescription(e.target.value)}
                    placeholder="Describe your rule in plain English... e.g., 'Tasks T1 and T2 should run together' or 'GroupA workers should have max 2 tasks per phase'"
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows={4}
                  />
                  <button onClick={handleCreateRule} className="button button-primary w-full">
                    <Sparkles className="w-4 h-4 mr-2" />
                    Convert to Rule with AI
                  </button>
                </div>
              </div>

              {/* Priority Settings */}
              <div className="card">
                <div className="flex items-center space-x-2 mb-4">
                  <Target className="w-5 h-5 text-green-500" />
                  <h3 className="text-lg font-semibold">Priority Weights</h3>
                </div>
                <div className="space-y-4">
                  {Object.entries(priorityWeights).map(([key, value]) => (
                    <div key={key}>
                      <div className="flex justify-between mb-2">
                        <label className="text-sm font-medium capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </label>
                        <span className="text-sm text-gray-600">{value}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="50"
                        value={value}
                        onChange={(e) => setPriorityWeights({
                          ...priorityWeights,
                          [key]: parseInt(e.target.value)
                        })}
                        className="slider w-full"
                      />
                    </div>
                  ))}
                  <div className="text-sm text-gray-600">
                    Total: {Object.values(priorityWeights).reduce((sum, val) => sum + val, 0)}%
                  </div>
                </div>
              </div>
            </div>

            {/* Active Rules */}
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Active Rules ({rules.length})</h3>
              {rules.length > 0 ? (
                <div className="space-y-3">
                  {rules.map(rule => (
                    <div key={rule.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">{rule.name}</h4>
                          <p className="text-sm text-gray-600">{rule.description}</p>
                          <span className="badge badge-success">{rule.type}</span>
                        </div>
                        <button
                          onClick={() => setRules(rules.filter(r => r.id !== rule.id))}
                          className="text-red-600 hover:bg-red-50 p-2 rounded"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Settings className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No rules created yet</p>
                  <p className="text-sm">Use the AI rule builder above to get started</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'validate' && (
          <div className="space-y-6">
            {/* Validation Summary */}
            <div className="card bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  {errorCount > 0 ? (
                    <XCircle className="w-6 h-6 text-red-500" />
                  ) : warningCount > 0 ? (
                    <AlertTriangle className="w-6 h-6 text-yellow-500" />
                  ) : (
                    <CheckCircle className="w-6 h-6 text-green-500" />
                  )}
                  <h3 className="text-lg font-semibold">
                    {errorCount > 0 ? 'Critical Issues' : warningCount > 0 ? 'Minor Issues' : 'All Valid'}
                  </h3>
                </div>
                <div className="text-right">
                  <div className={`text-2xl font-bold ${qualityInfo.color}`}>
                    {dataQuality}%
                  </div>
                  <div className="text-sm text-gray-600">{qualityInfo.status} Quality</div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{errorCount}</div>
                  <div className="text-sm text-gray-600">Errors</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">{warningCount}</div>
                  <div className="text-sm text-gray-600">Warnings</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{totalRecords - errors.length}</div>
                  <div className="text-sm text-gray-600">Valid Records</div>
                </div>
              </div>
            </div>

            {/* Validation Issues and AI Fixes */}
            {errors.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Validation Issues - Left Side */}
                <div className="card">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Validation Issues ({errors.length})</h3>
                    <button 
                      onClick={generateAICorrections} 
                      disabled={isGeneratingFixes}
                      className={`button ${isGeneratingFixes ? 'opacity-50 cursor-not-allowed' : 'button-primary'}`}
                    >
                      {isGeneratingFixes ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                          Finding Fixes...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Generate AI Fixes
                        </>
                      )}
                    </button>
                  </div>
                  
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {errors.map(error => (
                      <div key={error.id} className={`border rounded-lg p-3 ${error.type === 'error' ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50'}`}>
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center space-x-2 mb-1">
                              {error.type === 'error' ? (
                                <XCircle className="w-4 h-4 text-red-500" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                              )}
                              <span className="font-medium">{error.entityId}</span>
                              {error.field && <span className="badge badge-secondary">{error.field}</span>}
                            </div>
                            <p className="text-sm text-gray-700">{error.message}</p>
                            {error.suggestion && (
                              <p className="text-xs text-gray-500 mt-1">💡 {error.suggestion}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* AI Corrections - Right Side */}
                <div className="card">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">AI-Powered Fixes ({aiCorrections.length})</h3>
                    {isGeneratingFixes && (
                      <div className="flex items-center space-x-2 text-blue-600">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                        <span className="text-sm">Analyzing issues...</span>
                      </div>
                    )}
                    {showFixesSuccess && (
                      <div className="flex items-center space-x-2 text-green-600">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-sm">
                          {aiCorrections.length} of {errors.length} fixes generated!
                        </span>
                      </div>
                    )}
                  </div>
                  
                  {isGeneratingFixes ? (
                    <div className="text-center py-12">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
                      <p className="text-lg font-medium text-gray-700">AI is analyzing your data issues</p>
                      <p className="text-sm text-gray-500 mt-2">This may take a few moments...</p>
                    </div>
                  ) : aiCorrections.length > 0 ? (
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {aiCorrections.length < errors.length && (
                        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                          <div className="flex items-center space-x-2">
                            <AlertTriangle className="w-4 h-4 text-yellow-500" />
                            <span className="text-sm text-yellow-700">
                              AI generated {aiCorrections.length} fixes for {errors.length} errors. 
                              Some errors may need manual fixing.
                            </span>
                          </div>
                        </div>
                      )}
                      {aiCorrections.map((correction, index) => (
                        <div key={index} className="border rounded-lg p-3 bg-blue-50 border-blue-200">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-2">
                                <Sparkles className="w-4 h-4 text-blue-500" />
                                <span className="font-medium text-sm">{correction.entityId} - {correction.field}</span>
                              </div>
                              <div className="text-sm text-gray-700 mb-1">
                                <strong>Current:</strong> {JSON.stringify(correction.currentValue)}
                              </div>
                              <div className="text-sm text-gray-700 mb-1">
                                <strong>Suggested:</strong> {JSON.stringify(correction.suggestedValue)}
                              </div>
                              <div className="text-xs text-gray-500">{correction.reason}</div>
                            </div>
                            <button 
                              onClick={() => applyCorrection(correction)}
                              className="button button-primary ml-3"
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p className="text-lg font-medium">No AI fixes generated yet</p>
                      <p className="text-sm mt-2">Click "Generate AI Fixes" to get intelligent suggestions</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'export' && (
          <div className="space-y-6">
            <div className="text-center">
              <Download className="w-12 h-12 mx-auto mb-4 text-green-500" />
              <h2 className="text-2xl font-bold mb-2">Export Clean Data</h2>
              <p className="text-gray-600 max-w-2xl mx-auto">
                Download your validated and cleaned data along with business rules configuration
              </p>
            </div>

            <div className="card bg-gradient-to-r from-green-50 to-blue-50 border-green-200">
              <h3 className="text-lg font-semibold mb-4">Export Summary</h3>
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{totalRecords}</div>
                  <div className="text-sm text-gray-600">Total Records</div>
                </div>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${qualityInfo.color}`}>
                    {dataQuality}%
                  </div>
                  <div className="text-sm text-gray-600">{qualityInfo.status} Quality</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{rules.length}</div>
                  <div className="text-sm text-gray-600">Active Rules</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">
                    {Object.values(priorityWeights).reduce((sum, val) => sum + val, 0)}%
                  </div>
                  <div className="text-sm text-gray-600">Weight Total</div>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 className="text-lg font-semibold mb-4">Export Package</h3>
              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-blue-500" />
                    <span>Clean Data (Excel)</span>
                  </div>
                  <span className="badge badge-success">{totalRecords} records</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Settings className="w-4 h-4 text-purple-500" />
                    <span>Rules Configuration (JSON)</span>
                  </div>
                  <span className="badge badge-success">{rules.length} rules</span>
                </div>
              </div>
              
              <button 
                onClick={exportData}
                disabled={errorCount > 0}
                className={`button w-full ${errorCount > 0 ? 'opacity-50 cursor-not-allowed bg-gray-300' : 'button-primary'}`}
              >
                <Download className="w-5 h-5 mr-2" />
                {errorCount > 0 ? 'Fix Errors Before Export' : 'Export Clean Data Package'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}