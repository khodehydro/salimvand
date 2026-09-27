<#
.SYNOPSIS
    دریافت آخرین تغییرات از گیت‌هاب و دیپلوی سامانهٔ سلیم‌وند روی ویندوز (PowerShell).

.DESCRIPTION
    این اسکریپت برای سروری نوشته شده که هنوز پوشهٔ پروژه را ندارد: اگر پوشه موجود نباشد،
    مخزن را کلون می‌کند؛ اگر باشد، fetch + checkout انجام می‌دهد. سپس نصب وابستگی‌ها،
    Prisma generate/migrate/seed، Build هر سه اپ و ری‌استارت سرویس‌ها انجام می‌شود.

    سه سرویس اجرا می‌شوند (معادل واحدهای systemd روی لینوکس):
      salimvand-api     → node apps\api\dist\main.js          (پورت ۴۰۰۰)
      salimvand-website → node apps\website\.next\standalone\apps\website\server.js (پورت ۳۰۰۰)
      salimvand-worker  → node apps\api\dist\worker.js

    اگر pm2 نصب باشد، سرویس‌ها با pm2 مدیریت می‌شوند (و با `pm2 save` ماندگار)؛
    در غیر این صورت اسکریپت آن‌ها را با Start-Process بالا می‌آورد و PID را در
    <AppDir>\.pids ذخیره می‌کند. برای Production روی ویندوز نصب pm2
    (`npm i -g pm2` و `pm2-windows-startup`) یا NSSM توصیه می‌شود.

.PARAMETER AppDir
    مسیر نصب (پیش‌فرض: C:\salimvand). در صورت نبود، ساخته و کلون می‌شود.

.PARAMETER Branch
    شاخه‌ای که دیپلوی می‌شود (پیش‌فرض: arena/01a0dd70-salimvand).

.PARAMETER RepoUrl
    نشانی مخزن گیت‌هاب (پیش‌فرض: https://github.com/khodehydro/salimvand.git).

.PARAMETER PublicSiteUrl
    نشانی عمومی سایت برای لینک‌های مشتری (پیش‌فرض: مقدار PUBLIC_SITE_URL در .env).

.PARAMETER SkipRestart
    فقط دریافت و Build انجام شود، بدون ری‌استارت سرویس‌ها.

.PARAMETER InstallPrerequisites
    در صورت نبود git/Node.js، آن‌ها را با winget نصب کن.

.EXAMPLE
    # اجرای مستقیم از اینترنت (سرور بدون پوشهٔ پروژه):
    powershell -ExecutionPolicy Bypass -Command "iwr https://raw.githubusercontent.com/khodehydro/salimvand/arena/01a0dd70-salimvand/deploy/deploy-windows.ps1 -OutFile $env:TEMP\deploy.ps1; & $env:TEMP\deploy.ps1"

.EXAMPLE
    # اجرای محلی با شاخه و مسیر دلخواه:
    .\deploy\deploy-windows.ps1 -AppDir C:\salimvand -Branch arena/01a0dd70-salimvand
#>
[CmdletBinding()]
param(
    [string]$AppDir = 'C:\salimvand',
    [string]$Branch = 'arena/01a0dd70-salimvand',
    [string]$RepoUrl = 'https://github.com/khodehydro/salimvand.git',
    [string]$PublicSiteUrl = '',
    [switch]$SkipRestart,
    [switch]$InstallPrerequisites
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step($message) { Write-Host "`n=== $message ===" -ForegroundColor Cyan }
function Write-Ok($message) { Write-Host "  ✓ $message" -ForegroundColor Green }
function Write-Warn($message) { Write-Host "  ! $message" -ForegroundColor Yellow }
function Fail($message) { Write-Host "`nخطا: $message" -ForegroundColor Red; exit 1 }

function Get-CommandOrNull($name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)] $Arguments)
    & git @Arguments
    if ($LASTEXITCODE -ne 0) { Fail "git $($Arguments -join ' ') ناموفق بود (exit $LASTEXITCODE)" }
}

function Invoke-Pnpm {
    param([Parameter(ValueFromRemainingArguments = $true)] $Arguments)
    if (Get-CommandOrNull 'pnpm') {
        & pnpm @Arguments
    } elseif (Get-CommandOrNull 'corepack') {
        & corepack pnpm @Arguments
    } else {
        Fail 'pnpm پیدا نشد؛ آن را با `npm i -g pnpm@9.15.0` نصب کنید.'
    }
    if ($LASTEXITCODE -ne 0) { Fail "pnpm $($Arguments -join ' ') ناموفق بود (exit $LASTEXITCODE)" }
}

# ─────────────────────────── ۰ · پیش‌نیازها ───────────────────────────
Write-Step '۰ · بررسی پیش‌نیازها (git / Node.js / pnpm)'

if (-not (Get-CommandOrNull 'git')) {
    if ($InstallPrerequisites) {
        Write-Warn 'git نصب نیست — نصب با winget...'
        winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements | Out-Null
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    } else {
        Fail 'git نصب نیست. با `-InstallPrerequisites` اجرا کنید یا Git for Windows را نصب کنید.'
    }
}
if (-not (Get-CommandOrNull 'node')) {
    if ($InstallPrerequisites) {
        Write-Warn 'Node.js نصب نیست — نصب نسخهٔ ۲۰ با winget...'
        winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements | Out-Null
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    } else {
        Fail 'Node.js نصب نیست. با `-InstallPrerequisites` اجرا کنید یا Node 20+ را نصب کنید.'
    }
}
$nodeVersion = (node -v)
Write-Ok "Node $nodeVersion"
if (-not (Get-CommandOrNull 'pnpm')) {
    Write-Warn 'pnpm پیدا نشد — نصب pnpm@9.15.0 با npm...'
    npm install -g pnpm@9.15.0 | Out-Null
}
Write-Ok 'git / Node.js / pnpm آماده است'

# ─────────────────────────── ۱ · دریافت از گیت‌هاب ───────────────────────────
Write-Step "۱ · دریافت شاخهٔ $Branch از گیت‌هاب"

if (-not (Test-Path $AppDir)) {
    New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
}
if (-not (Test-Path (Join-Path $AppDir '.git'))) {
    $empty = Test-Path $AppDir -PathType Container
    $hasFiles = $empty -and ((Get-ChildItem $AppDir -Force | Measure-Object).Count -gt 0)
    if ($hasFiles) { Fail "پوشهٔ $AppDir وجود دارد اما مخزن گیت نیست. آن را خالی کنید یا مسیر دیگری بدهید (-AppDir)." }
    Write-Host "  کلون $RepoUrl → $AppDir"
    Invoke-Git clone $RepoUrl $AppDir
} else {
    Write-Ok 'مخزن موجود است — فقط به‌روزرسانی انجام می‌شود'
}

Set-Location $AppDir
Invoke-Git fetch --prune origin
Invoke-Git checkout $Branch
if ((git rev-parse --abbrev-ref HEAD) -ne $Branch) { Fail "checkout روی $Branch انجام نشد" }
Invoke-Git reset --hard "origin/$Branch"
Invoke-Git submodule update --init --recursive

$commit = (git rev-parse HEAD)
$shortCommit = (git rev-parse --short HEAD)
Write-Ok "آخرین نسخه دریافت شد: $shortCommit"

# شناسهٔ نسخهٔ در حال اجرا (پنل و /health آن را نشان می‌دهند)
$version = [ordered]@{
    commit  = $commit
    branch  = $Branch
    builtAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}
$version | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $AppDir 'version.json') -Encoding UTF8

# ─────────────────────────── ۲ · تنظیمات (.env) ───────────────────────────
Write-Step '۲ · بررسی فایل تنظیمات .env'
$envFile = Join-Path $AppDir '.env'
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $AppDir '.env.example') $envFile
    Write-Warn '.env ساخته شد از .env.example — مقادیر واقعی (DATABASE_URL، JWT، CORS…) را پر کنید.'
    Write-Warn "ادامه متوقف شد. پس از ویرایش $envFile دوباره همین اسکریپت را اجرا کنید."
    exit 2
}
Write-Ok '.env موجود است'

# متغیرهای .env را برای مراحل بعد (Prisma و Build) بارگذاری کن
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { return }
    $key = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim().Trim('"')
    if (-not [string]::IsNullOrWhiteSpace($key)) { Set-Item -Path "env:$key" -Value $value }
}
$env:NODE_ENV = 'production'
$siteUrl = if ($PublicSiteUrl) { $PublicSiteUrl } else { $env:PUBLIC_SITE_URL }
if (-not $siteUrl) { $siteUrl = 'https://salimvand.ir' }
# پنل و API در Production هم‌منشأ هستند؛ هیچ VITE_API_URL محلی در bundle قرار نگیرد.
$env:VITE_API_URL = '/api/v1'
$env:VITE_PUBLIC_SITE_URL = $siteUrl

# ─────────────────────────── ۳ · نصب وابستگی‌ها ───────────────────────────
Write-Step '۳ · نصب وابستگی‌ها (pnpm install --frozen-lockfile)'
Invoke-Pnpm install --frozen-lockfile --prod=false

# ─────────────────────────── ۴ · دیتابیس ───────────────────────────
Write-Step '۴ · Prisma generate / migrate / seed'
Invoke-Pnpm --filter '@salimvand/shared' build
Invoke-Pnpm --filter '@salimvand/api' exec prisma generate
Invoke-Pnpm --filter '@salimvand/api' exec prisma migrate deploy
Invoke-Pnpm --filter '@salimvand/api' prisma:seed
Write-Ok 'دیتابیس به‌روز شد (ستون سبدها با migration اضافه می‌شود)'

# ─────────────────────────── ۵ · Build ───────────────────────────
Write-Step '۵ · Build هر سه اپ (api / admin / website)'
Invoke-Pnpm build

# Next.js روی ویندوز هم فایل‌های استاتیک را کنار standalone کپی می‌کند؛ در صورت
# نبود، اینجا جبران می‌شود تا سایت بدون asset بالا نیاید.
$standalone = Join-Path $AppDir 'apps\website\.next\standalone'
if (Test-Path $standalone) {
    $target = Join-Path $standalone 'apps\website\.next'
    if (Test-Path (Join-Path $AppDir 'apps\website\.next\static')) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Copy-Item (Join-Path $AppDir 'apps\website\.next\static') $target -Recurse -Force
    }
    if (Test-Path (Join-Path $AppDir 'apps\website\public')) {
        Copy-Item (Join-Path $AppDir 'apps\website\public') $standalone -Recurse -Force
    }
}
New-Item -ItemType Directory -Path (Join-Path $AppDir 'uploads\products') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $AppDir 'uploads\site') -Force | Out-Null
Write-Ok 'Build کامل شد'

if ($SkipRestart) {
    Write-Host "`nدرخواست شد که سرویس‌ها ری‌استارت نشوند (-SkipRestart). پایان." -ForegroundColor Yellow
    exit 0
}

# ─────────────────────────── ۶ · ری‌استارت سرویس‌ها ───────────────────────────
Write-Step '۶ · ری‌استارت سرویس‌ها'
$pm2 = Get-CommandOrNull 'pm2'
$services = @(
    @{ Name = 'salimvand-api'; Script = (Join-Path $AppDir 'apps\api\dist\main.js'); WorkDir = $AppDir },
    @{ Name = 'salimvand-website'; Script = (Join-Path $AppDir 'apps\website\.next\standalone\apps\website\server.js'); WorkDir = (Join-Path $AppDir 'apps\website\.next\standalone') },
    @{ Name = 'salimvand-worker'; Script = (Join-Path $AppDir 'apps\api\dist\worker.js'); WorkDir = $AppDir }
)

if ($pm2) {
    foreach ($service in $services) {
        & pm2 describe $service.Name | Out-Null
        if ($LASTEXITCODE -eq 0) {
            & pm2 restart $service.Name --update-env | Out-Null
            Write-Ok "$($service.Name) ری‌استارت شد"
        } else {
            & pm2 start $service.Script --name $service.Name --cwd $service.WorkDir --time | Out-Null
            Write-Ok "$($service.Name) استارت شد"
        }
    }
    & pm2 save | Out-Null
} else {
    Write-Warn 'pm2 نصب نیست — سرویس‌ها با Start-Process بالا می‌آیند (برای Production نصب pm2 توصیه می‌شود).'
    $pidFile = Join-Path $AppDir '.pids'
    foreach ($service in $services) {
        $existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
            Where-Object { $_.CommandLine -like "*$($service.Script)*" }
        foreach ($process in $existing) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
        $process = Start-Process -FilePath 'node' -ArgumentList "`"$($service.Script)`"" `
            -WorkingDirectory $service.WorkDir -WindowStyle Hidden -PassThru
        "$($service.Name)=$($process.Id)" | Out-File -FilePath $pidFile -Append -Encoding UTF8
        Write-Ok "$($service.Name) بالا آمد (PID $($process.Id))"
    }
}

# ─────────────────────────── ۷ · بررسی سلامت ───────────────────────────
Write-Step '۷ · بررسی سلامت API'
$ready = $false
for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/v1/health/ready' -TimeoutSec 5
        if ($response) { $ready = $true; break }
    } catch {
        # هنوز بالا نیامده — دوباره تلاش می‌شود
    }
}
if (-not $ready) {
    Write-Warn 'API در ۶۰ ثانیه آماده نشد. لاگ را ببینید:'
    if ($pm2) { & pm2 logs salimvand-api --lines 60 --nostream }
    Fail 'Health check ناموفق بود.'
}
Write-Ok "انتشار $shortCommit روی سرور فعال است."
if ($pm2) { & pm2 status }
