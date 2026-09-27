<#
.SYNOPSIS
    دیپلوی سلیم‌وند از ویندوز روی سرور لینوکس (SSH) — بدون نیاز به پوشهٔ پروژه روی سرور.

.DESCRIPTION
    این اسکریپت روی «کامپیوتر شما» (ویندوز) اجرا می‌شود، با SSH به سرور لینوکس وصل
    می‌شود و همان‌جا آخرین تغییرات را از گیت‌هاب می‌گیرد و دیپلوی می‌کند. یعنی روی
    سرور هیچ پوشه‌ای از قبل لازم نیست: اگر مسیر نصب وجود نداشته باشد مخزن کلون
    می‌شود؛ اگر باشد، فقط fetch/checkout انجام می‌شود و بعد scripts/deploy.sh اجرا می‌گردد.

    مراحل روی سرور (همان scripts/deploy.sh):
      git clone/fetch → ساخت .env در صورت نبود → pnpm install → prisma generate
      → migrate deploy → seed → typecheck → build → کپی assetهای Next
      → ری‌استارت سرویس‌های systemd → بررسی سلامت

.PARAMETER Host
    نشانی یا IP سرور لینوکس (اجباری). مثال: root@185.143.233.10

.PARAMETER AppDir
    مسیر نصب روی سرور (پیش‌فرض: /opt/salimvand).

.PARAMETER Branch
    شاخه‌ای که دیپلوی می‌شود (پیش‌فرض: main — شاخهٔ بررسی‌شدهٔ Production).
    برای انتشار همین شاخهٔ کاری: -Branch arena/01a0dd70-salimvand

.PARAMETER RepoUrl
    نشانی مخزن گیت‌هاب (پیش‌فرض: https://github.com/khodehydro/salimvand.git).

.PARAMETER SshKey
    مسیر کلید خصوصی SSH (اختیاری؛ مثلاً $HOME\.ssh\id_ed25519).

.PARAMETER Port
    پورت SSH (پیش‌فرض: ۲۲).

.PARAMETER ServiceUser
    کاربر سرویس روی سرور (پیش‌فرض: salimvand).

.PARAMETER SkipRestart
    فقط دریافت و Build انجام شود؛ سرویس‌ها ری‌استارت نشوند.

.EXAMPLE
    # انتشار شاخهٔ اصلی روی سرور
    powershell -ExecutionPolicy Bypass -File .\deploy\deploy-remote.ps1 -Host root@185.143.233.10

.EXAMPLE
    # انتشار این شاخهٔ کاری با کلید SSH
    powershell -ExecutionPolicy Bypass -File .\deploy\deploy-remote.ps1 `
        -Host root@185.143.233.10 -Branch arena/01a0dd70-salimvand `
        -SshKey "$HOME\.ssh\id_ed25519"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Host,
    [string]$AppDir = '/opt/salimvand',
    [string]$Branch = 'main',
    [string]$RepoUrl = 'https://github.com/khodehydro/salimvand.git',
    [string]$SshKey = '',
    [int]$Port = 22,
    [string]$ServiceUser = 'salimvand',
    [switch]$SkipRestart
)

$ErrorActionPreference = 'Stop'

function Write-Step($message) { Write-Host "`n=== $message ===" -ForegroundColor Cyan }
function Write-Ok($message) { Write-Host "  ✓ $message" -ForegroundColor Green }
function Write-Warn($message) { Write-Host "  ! $message" -ForegroundColor Yellow }
function Fail($message) { Write-Host "`nخطا: $message" -ForegroundColor Red; exit 1 }

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Fail 'دستور ssh پیدا نشد. OpenSSH Client را نصب کنید (Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0).'
}

# Every ssh call shares these options: accept-new keeps a first-run host key
# prompt from stalling an unattended deploy.
$sshBase = @('-p', "$Port", '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes')
if ($SshKey) { $sshBase += @('-i', $SshKey) }
$target = $Host

function Invoke-Ssh {
    param(
        [string]$Command,
        [switch]$AllowFailure
    )
    $output = & ssh @sshBase $target $Command 2>&1
    $code = $LASTEXITCODE
    $output | ForEach-Object { Write-Host "    $_" }
    if ($code -ne 0 -and -not $AllowFailure) {
        Fail "دستور روی سرور ناموفق بود (exit $code): $Command"
    }
    return $code
}

function Invoke-SshResult {
    param([string]$Command)
    $output = & ssh @sshBase $target $Command 2>$null
    return ($output | Select-Object -Last 1)
}

# ─────────────────────────── ۰ · اتصال ───────────────────────────
Write-Step "۰ · بررسی اتصال SSH به $target"
Invoke-Ssh 'uname -sr' | Out-Null
# Root needs no sudo; a sudoer account does. Detect once and prefix every
# privileged command with it.
$uid = (Invoke-SshResult 'id -u').ToString().Trim()
$sudo = if ($uid -eq '0') { '' } else { 'sudo ' }
Write-Ok "اتصال برقرار است (uid=$uid$(
        if ($sudo) { ' — دستورها با sudo اجرا می‌شوند' } else { '' }))"

# ─────────────────────────── ۱ · دریافت از گیت‌هاب ───────────────────────────
Write-Step "۱ · دریافت شاخهٔ $Branch از گیت‌هاب روی سرور"
$cloneOrFetch = @"
set -e
${sudo}mkdir -p '$AppDir'
if [ ! -d '$AppDir/.git' ]; then
  echo '  پوشهٔ پروژه روی سرور نبود — کلون مخزن'
  ${sudo}git clone '$RepoUrl' '$AppDir'
fi
cd '$AppDir'
${sudo}git fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'
${sudo}git checkout --detach "origin/$Branch"
${sudo}chown -R '$ServiceUser':'$ServiceUser' '$AppDir' 2>/dev/null || true
echo "  HEAD=`$(${sudo}git rev-parse --short HEAD)"
"@
Invoke-Ssh $cloneOrFetch | Out-Null
Write-Ok 'آخرین نسخه روی سرور دریافت شد'

# ─────────────────────────── ۲ · تنظیمات (.env) ───────────────────────────
Write-Step '۲ · بررسی فایل تنظیمات .env روی سرور'
$envState = (Invoke-SshResult "test -f '$AppDir/.env' && echo EXISTS || echo MISSING").ToString().Trim()
if ($envState -ne 'EXISTS') {
    Write-Warn ".env روی سرور نیست — از .env.example ساخته می‌شود."
    Invoke-Ssh "${sudo}cp '$AppDir/.env.example' '$AppDir/.env' && ${sudo}chown '$ServiceUser':'$ServiceUser' '$AppDir/.env' && ${sudo}chmod 600 '$AppDir/.env'" | Out-Null
    Write-Host "`n  فایل $AppDir/.env روی سرور ساخته شد. آن را ویرایش کنید" -ForegroundColor Yellow
    Write-Host "  (DATABASE_URL، JWT_SECRET، PUBLIC_SITE_URL، CORS و ...) و دوباره اجرا کنید:" -ForegroundColor Yellow
    Write-Host "    ssh $target" -ForegroundColor Yellow
    Write-Host "    ${sudo}nano $AppDir/.env" -ForegroundColor Yellow
    exit 2
}
Write-Ok '.env موجود است'

# ─────────────────────────── ۳ · دیپلوی ───────────────────────────
Write-Step '۳ · اجرای scripts/deploy.sh روی سرور (نصب، Prisma، Build، ری‌استارت)'
$skipVar = if ($SkipRestart) { ' SKIP_RESTART=1' } else { '' }
$deployCommand = "cd '$AppDir' && ${sudo}env APP_DIR='$AppDir' DEPLOY_BRANCH='$Branch'$skipVar ./scripts/deploy.sh"
Invoke-Ssh $deployCommand | Out-Null
Write-Ok 'دیپلوی روی سرور کامل شد'

# ─────────────────────────── ۴ · وضعیت و سلامت ───────────────────────────
Write-Step '۴ · وضعیت سرویس‌ها'
Invoke-Ssh 'systemctl status salimvand-api.service salimvand-website.service salimvand-worker.service --no-pager --lines=0' -AllowFailure | Out-Null
Invoke-Ssh "cat '$AppDir/version.json'" -AllowFailure | Out-Null
Invoke-Ssh 'curl -fsS --max-time 5 http://127.0.0.1:4000/api/v1/health/ready; echo' -AllowFailure | Out-Null

Write-Host "`nپایان. سایت و پنل روی سرور به‌روز هستند." -ForegroundColor Green
Write-Host "لاگ زنده در صورت نیاز:" -ForegroundColor Cyan
Write-Host "  ssh $target" -ForegroundColor Cyan
Write-Host "  ${sudo}journalctl -u salimvand-api -f" -ForegroundColor Cyan
