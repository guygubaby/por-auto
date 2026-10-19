$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapTransform, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($operation, $type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
    $task.GetAwaiter().GetResult()
}
try {
    $tag = if ($env:POR_OCR_LANGUAGE) { $env:POR_OCR_LANGUAGE } else { 'zh-Hans' }
    $language = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Where-Object { $_.LanguageTag.StartsWith($tag, [System.StringComparison]::OrdinalIgnoreCase) -or ($tag -eq 'zh-Hans' -and $_.LanguageTag -eq 'zh-CN') } | Select-Object -First 1
    if (-not $language) { throw '请在 Windows 设置中安装简体中文的文字识别语言功能，然后重试' }
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
    Add-Type -AssemblyName System.Drawing
    $inputImage = [System.Drawing.Image]::FromFile($env:POR_OCR_IMAGE_PATH)
    $canvas = New-Object System.Drawing.Bitmap($inputImage.Width, $inputImage.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $attributes = New-Object System.Drawing.Imaging.ImageAttributes
    try {
        $matrix = New-Object System.Drawing.Imaging.ColorMatrix
        $matrix.Matrix00 = 4; $matrix.Matrix11 = 4; $matrix.Matrix22 = 4
        $matrix.Matrix40 = -2; $matrix.Matrix41 = -2; $matrix.Matrix42 = -2
        $attributes.SetColorMatrix($matrix)
        $graphics.DrawImage($inputImage, (New-Object System.Drawing.Rectangle(0,0,$inputImage.Width,$inputImage.Height)), 0,0,$inputImage.Width,$inputImage.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
        $contrast = [System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName($env:POR_OCR_IMAGE_PATH), 'ocr-contrast.png')
        $canvas.Save($contrast, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $attributes.Dispose(); $graphics.Dispose(); $canvas.Dispose(); $inputImage.Dispose() }
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($contrast)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $words = New-Object System.Collections.Generic.List[object]
        foreach ($footer in @($false, $true)) {
            $offset = 0
            $scale = [Math]::Min(1.0, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension / [double][Math]::Max($decoder.PixelWidth, $decoder.PixelHeight))
            $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
            if ($footer) {
                $height = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelHeight / 8))
                $offset = $decoder.PixelHeight - $height
                $bounds = New-Object Windows.Graphics.Imaging.BitmapBounds
                $scale = [Math]::Min(2.0, [Windows.Media.Ocr.OcrEngine]::MaxImageDimension / [double]$decoder.PixelWidth)
                $bounds.X = 0; $bounds.Y = [uint32]($offset * $scale); $bounds.Width = [uint32]($decoder.PixelWidth * $scale); $bounds.Height = [uint32]($height * $scale)
                $transform.Bounds = $bounds
                $transform.ScaledWidth = [uint32]($decoder.PixelWidth * $scale)
                $transform.ScaledHeight = [uint32]($decoder.PixelHeight * $scale)
            } else {
                $transform.ScaledWidth = [uint32]($decoder.PixelWidth * $scale)
                $transform.ScaledHeight = [uint32]($decoder.PixelHeight * $scale)
            }
            $bitmap = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
            try {
                $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
                foreach ($line in $result.Lines) {
                    if ($footer) {
                        foreach ($word in $line.Words) {
                            $b = $word.BoundingRect
                            $words.Add(@{ text=$word.Text; bounds=@([int]($b.X/$scale), [int]($b.Y/$scale)+$offset, [int](($b.X+$b.Width)/$scale), [int](($b.Y+$b.Height)/$scale)+$offset) })
                        }
                    } else {
                        $left = ($line.Words | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
                        $top = ($line.Words | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
                        $right = ($line.Words | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
                        $bottom = ($line.Words | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
                        $words.Add(@{ text=$line.Text; bounds=@([int]($left/$scale), [int]($top/$scale), [int]($right/$scale), [int]($bottom/$scale)) })
                    }
                }
            } finally { $bitmap.Dispose() }
        }
        ConvertTo-Json -InputObject @($words.ToArray()) -Depth 4 -Compress
    } finally { $stream.Dispose() }
} catch {
    [Console]::Error.WriteLine('本机文字识别失败：' + $_.Exception.Message)
    exit 1
}
