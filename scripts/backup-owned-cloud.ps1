param([Parameter(Mandatory=$true)][string]$NodeExe,[string]$ExistingSql,[string]$OutputPath)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
if(!$OutputPath){$OutputPath=Join-Path $taskRoot ('outputs/backups/qiansiwanlv-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.sql.dpapi')}
$taskSql=$ExistingSql
$taskGenerated=$false
if(!$taskSql){
    $taskSql=Join-Path $taskRoot ('work/owned-cloud/backup-'+[guid]::NewGuid().ToString()+'.sql')
    $taskGenerated=$true
    Push-Location $taskRoot
    try{
        $taskExportOutput=& $NodeExe --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 export DB --remote --config work/owned-cloud/wrangler.json --output $taskSql 2>&1
        if($LASTEXITCODE -ne 0){throw 'Cloud database export failed; no backup was saved.'}
    }finally{Pop-Location}
}
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$taskBytes=[IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $taskSql))
$taskProtected=[Security.Cryptography.ProtectedData]::Protect($taskBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
$taskAbsolute=[IO.Path]::GetFullPath($OutputPath)
[IO.Directory]::CreateDirectory((Split-Path -Parent $taskAbsolute))|Out-Null
[IO.File]::WriteAllBytes($taskAbsolute,$taskProtected)
$taskRestored=[Security.Cryptography.ProtectedData]::Unprotect($taskProtected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
if([Convert]::ToBase64String($taskBytes) -ne [Convert]::ToBase64String($taskRestored)){throw 'Backup encryption verification failed'}
if($taskGenerated){Remove-Item -LiteralPath $taskSql}
Write-Output ('Encrypted complete backup saved: '+$taskAbsolute)
Write-Output 'This backup requires the same Windows user profile to decrypt; Cloudflare Time Travel remains separate.'
