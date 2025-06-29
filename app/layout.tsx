import './globals.css'

export const metadata = {
  title: 'Data Alchemist - AI Resource Allocation Configurator',
  description: 'Transform messy spreadsheets into clean, validated datasets',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}