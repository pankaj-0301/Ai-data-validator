# Data  - AI Resource Allocation Configurator

A Next.js application that uses Gemini AI to help configure and validate resource allocation data.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create environment file:**
   Create a `.env.local` file in the root directory with your Gemini API key:
   ```
   NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

4. **Open your browser:**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Features

### 🔍 Enhanced Search Functionality
- **Real-time Search**: Instant results as you type
- **AI-Powered Search**: Advanced natural language queries using Gemini AI
- **Smart Results**: Clear results with detailed information for each item
- **Auto-clear**: Results automatically clear when search box is empty
- **Loading States**: Visual feedback during AI search operations

### 📊 Data Management
- **Multi-format Upload**: Support for CSV and Excel files
- **Intelligent Parsing**: AI-powered data normalization and validation
- **Real-time Validation**: Comprehensive error checking with suggestions
- **AI Corrections**: Automated fix suggestions for data issues

### ⚙️ Rule Configuration
- **Natural Language Rules**: Convert plain English to structured business rules
- **Priority Weights**: Configurable allocation priorities
- **Visual Rule Management**: Easy rule creation and management

### 📤 Export & Validation
- **Clean Data Export**: Download validated data in Excel format
- **Configuration Export**: Save rules and settings as JSON
- **Quality Metrics**: Data quality scoring and validation reports

## Search Examples

### Real-time Search
- Type any text to instantly search across all data
- Results show immediately with relevant details

### AI-Powered Queries
- "tasks with duration > 2"
- "workers with coding skills"
- "clients with priority 5"
- "high priority clients"
- "short duration tasks"

## Environment Variables

- `NEXT_PUBLIC_GEMINI_API_KEY`: Your Gemini AI API key (required for AI features)

## File Structure

- `app/page.tsx`: Main application component
- `samples/`: Sample CSV files for testing
- `components.json`: UI component configuration
- `tailwind.config.ts`: Tailwind CSS configuration
