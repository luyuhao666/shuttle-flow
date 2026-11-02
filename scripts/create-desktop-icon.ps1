$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputPath = Join-Path $projectRoot 'assets\desktop'
[IO.Directory]::CreateDirectory($outputPath) | Out-Null
$bitmap = [Drawing.Bitmap]::new(256,256)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.ColorTranslator]::FromHtml('#10342e'))
$lime = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#d7f583'),12)
$stringPen = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#a6c78c'),3)
$handle = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#f1f6e6'),17)
$handle.StartCap = $handle.EndCap = [Drawing.Drawing2D.LineCap]::Round
$graphics.TranslateTransform(131,104)
$graphics.RotateTransform(32)
$graphics.DrawEllipse($lime,-46,-62,92,124)
foreach ($offset in @(-22,0,22)) { $graphics.DrawLine($stringPen,$offset,-48,$offset,48) }
foreach ($offset in @(-28,0,28)) { $graphics.DrawLine($stringPen,-36,$offset,36,$offset) }
$graphics.DrawLine($lime,0,62,0,81)
$graphics.DrawLine($handle,0,85,0,127)
$graphics.ResetTransform()
$brush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#f1f6e6'))
$points = [Drawing.PointF[]]@([Drawing.PointF]::new(184,167),[Drawing.PointF]::new(221,147),[Drawing.PointF]::new(216,191))
$graphics.FillPolygon($brush,$points)
$graphics.FillEllipse($brush,179,165,17,17)
$bitmap.Save((Join-Path $outputPath 'icon.png'),[Drawing.Imaging.ImageFormat]::Png)
$sizes = @(16,32,48,64,128,256)
$images = @()
foreach ($size in $sizes) {
  $scaled = [Drawing.Bitmap]::new($size,$size)
  $scaledGraphics = [Drawing.Graphics]::FromImage($scaled)
  $scaledGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $scaledGraphics.DrawImage($bitmap,0,0,$size,$size)
  $stream = [IO.MemoryStream]::new()
  $scaled.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
  $images += ,$stream.ToArray()
  $scaledGraphics.Dispose(); $scaled.Dispose(); $stream.Dispose()
}
$iconStream = [IO.MemoryStream]::new()
$writer = [IO.BinaryWriter]::new($iconStream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Length)
$offset = 6 + 16 * $sizes.Length
for ($index = 0; $index -lt $sizes.Length; $index++) {
  $dimension = if ($sizes[$index] -eq 256) { 0 } else { $sizes[$index] }
  $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32)
  $writer.Write([uint32]$images[$index].Length); $writer.Write([uint32]$offset)
  $offset += $images[$index].Length
}
foreach ($bytes in $images) { $writer.Write([byte[]]$bytes) }
[IO.File]::WriteAllBytes((Join-Path $outputPath 'icon.ico'),$iconStream.ToArray())
$writer.Dispose(); $iconStream.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $lime.Dispose(); $stringPen.Dispose(); $handle.Dispose(); $brush.Dispose()
Write-Output 'Desktop icons generated.'
