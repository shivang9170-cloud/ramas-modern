# Saves a Word file as PDF with Microsoft Word (installed on this PC).
#   powershell -ExecutionPolicy Bypass -File docs\tools\docx-to-pdf.ps1 docs\Ramas-Debugging-Guide.docx
param([Parameter(Mandatory = $true)][string]$Docx)
$in = (Resolve-Path $Docx).Path
$out = [IO.Path]::ChangeExtension($in, '.pdf')
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
  $doc = $word.Documents.Open($in, $false, $true)
  $doc.SaveAs2($out, 17)   # 17 = PDF
  $doc.Close($false)
  Write-Host "PDF: $out"
} finally {
  $word.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
