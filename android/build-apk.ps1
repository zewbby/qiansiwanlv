param(
    [Parameter(Mandatory = $true)][string]$JavaHome,
    [Parameter(Mandatory = $true)][string]$SdkPath,
    [Parameter(Mandatory = $true)][string]$GradleExe,
    [string]$SigningProperties,
    [string]$NodeExe = 'node'
)

$ErrorActionPreference = 'Stop'
$taskAndroidDir = $PSScriptRoot
$taskProjectDir = Split-Path -Parent $taskAndroidDir
$taskWorkDir = Join-Path $taskProjectDir 'work'
$taskOutputDir = Join-Path $taskProjectDir 'outputs'
foreach ($taskRequiredPath in @($JavaHome, $SdkPath, $GradleExe)) {
    if (!(Test-Path -LiteralPath $taskRequiredPath)) {
        throw "Build tool path is unavailable: $taskRequiredPath"
    }
}
if (!$SigningProperties) {
    $SigningProperties = Join-Path $taskWorkDir 'android-signing\signing.properties'
}
if (!(Test-Path -LiteralPath $SigningProperties)) {
    throw 'Provide the existing release signing properties; keep the signing key to preserve app updates.'
}

$taskPreviousJavaHome = $env:JAVA_HOME
$taskPreviousSigningPath = $env:BARBERSHOP_SIGNING_PROPERTIES
try {
    Push-Location $taskProjectDir
    try {
        & $NodeExe ./node_modules/vite/bin/vite.js build --config offline/vite.config.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Bundled offline interface build failed.' }
    } finally { Pop-Location }
    $env:JAVA_HOME = $JavaHome
    $env:BARBERSHOP_SIGNING_PROPERTIES = (Resolve-Path -LiteralPath $SigningProperties).Path
    $taskSdkAbsolute = (Resolve-Path -LiteralPath $SdkPath).Path.Replace('\', '/')
    [System.IO.File]::WriteAllText(
        (Join-Path $taskAndroidDir 'local.properties'),
        "sdk.dir=$taskSdkAbsolute",
        (New-Object System.Text.UTF8Encoding($false))
    )
    & $GradleExe -p $taskAndroidDir -g (Join-Path $taskWorkDir 'android-gradle') --no-daemon --console=plain :app:assembleRelease
    if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' }
    New-Item -ItemType Directory -Path $taskOutputDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $taskAndroidDir 'app\build\outputs\apk\release\app-release.apk') -Destination (Join-Path $taskOutputDir 'qiansiwanlv.apk') -Force
    Write-Output (Join-Path $taskOutputDir 'qiansiwanlv.apk')
} finally {
    $env:JAVA_HOME = $taskPreviousJavaHome
    $env:BARBERSHOP_SIGNING_PROPERTIES = $taskPreviousSigningPath
}
