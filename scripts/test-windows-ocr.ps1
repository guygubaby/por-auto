$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot '../src-tauri/src/ocr-windows.ps1'
$tokens = $null; $parseErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($helper, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$languages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
if (-not $languages.Count) {
    Write-Warning 'Native OCR syntax passed; this Windows runner has no OCR language installed, image recognition was not verified.'
    exit 0
}
$language = $languages | Where-Object { $_.LanguageTag -like 'en-*' } | Select-Object -First 1
if (-not $language) { $language = $languages[0] }
$folder = Join-Path ([System.IO.Path]::GetTempPath()) ('por-native-ocr-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory $folder
try {
    Add-Type -AssemblyName System.Drawing
    $bitmap = New-Object System.Drawing.Bitmap(800,400)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $font = New-Object System.Drawing.Font('Segoe UI',52)
    try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.DrawString('PorAuto123', $font, [System.Drawing.Brushes]::Black, 25,25)
        $graphics.DrawString('Me', $font, [System.Drawing.Brushes]::Gray, 600,320)
        $image = Join-Path $folder 'ocr-screen.png'
        $bitmap.Save($image,[System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
    $env:POR_OCR_LANGUAGE = $language.LanguageTag
    $env:POR_OCR_IMAGE_PATH = $image
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([IO.File]::ReadAllText($helper)))
    if ($encoded.Length -gt 28000) { throw 'OCR helper exceeds safe Windows command-line length' }
    $output = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded
    if ($LASTEXITCODE -ne 0) { throw 'Native OCR helper failed' }
    $words = $output | ConvertFrom-Json
    if (-not ($words | Where-Object { $_.text -match 'PorAuto123' -and $_.bounds.Count -eq 4 })) { throw 'Native OCR did not read the synthetic fixture' }
    Write-Host ('Native Windows OCR passed: image decode, contrast, crop, async WinRT and JSON; language=' + $language.LanguageTag)
} finally {
    Remove-Item -Recurse -Force $folder
    Remove-Item Env:POR_OCR_LANGUAGE -ErrorAction SilentlyContinue
    Remove-Item Env:POR_OCR_IMAGE_PATH -ErrorAction SilentlyContinue
}
