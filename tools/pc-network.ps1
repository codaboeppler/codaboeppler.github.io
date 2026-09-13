<#
=====================================================================
 pc-network.ps1  --  why does the internet keep dropping?
=====================================================================

 Separate question from pc-check.ps1, and usually a separate cause.
 Intermittent disconnects are far more often a tired router, a weak
 Wi-Fi signal, or a network adapter being put to sleep to save power
 than they are a sign of anything malicious.

 This script is READ-ONLY. It reads adapter settings, the DHCP lease
 and the system event log, and generates Windows' own Wi-Fi report.
 It changes nothing.

 HOW TO RUN
   Right-click -> "Run with PowerShell", or:
       powershell -ExecutionPolicy Bypass -File .\pc-network.ps1

 THE MOST USEFUL OUTPUT is the Wi-Fi report it opens in your browser:
 a timeline of every disconnect over the last three days with the
 reason for each one. Windows generates it; it is genuinely good.
=====================================================================
#>

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]'Administrator')) {
    Write-Host "This needs Administrator rights. Re-launching..." -ForegroundColor Yellow
    Start-Process powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$ErrorActionPreference = 'SilentlyContinue'
$report = "$env:USERPROFILE\Desktop\pc-network.txt"
function Log($title, $output) {
    "`n`n########## $title ##########" | Out-File $report -Append -Encoding utf8
    ($output | Out-String -Width 300)  | Out-File $report -Append -Encoding utf8
}

"NETWORK DIAGNOSTIC  $(Get-Date)  $env:COMPUTERNAME" | Out-File $report -Encoding utf8
Write-Host "`nChecking network...`n" -ForegroundColor Cyan

# --- adapters ---------------------------------------------------------
Write-Host "  . adapters" -ForegroundColor DarkGray
Log 'NETWORK ADAPTERS' (Get-NetAdapter | Select-Object Name, InterfaceDescription, Status, LinkSpeed, DriverVersion, DriverDate | Format-Table -Auto)

# Power management is a very common cause of "it drops every so often".
Write-Host "  . adapter power management" -ForegroundColor DarkGray
$power = Get-NetAdapterPowerManagement -Name * | Select-Object Name, AllowComputerToTurnOffDevice
Log 'ADAPTER POWER MANAGEMENT' ($power | Format-Table -Auto)
$sleepy = $power | Where-Object { $_.AllowComputerToTurnOffDevice -eq 'Enabled' }

# --- Wi-Fi ------------------------------------------------------------
Write-Host "  . Wi-Fi signal and history" -ForegroundColor DarkGray
Log 'WIRELESS INTERFACE' (netsh wlan show interfaces)
Log 'SAVED WIRELESS PROFILES' (netsh wlan show profiles)

# --- addressing -------------------------------------------------------
Write-Host "  . IP configuration" -ForegroundColor DarkGray
Log 'IP CONFIGURATION' (Get-NetIPConfiguration | Format-List)
Log 'DHCP LEASE' (ipconfig /all)

# --- what the event log says ------------------------------------------
Write-Host "  . event log (this takes a moment)" -ForegroundColor DarkGray
$events = Get-WinEvent -LogName System -MaxEvents 4000 |
          Where-Object {
              $_.LevelDisplayName -in 'Error', 'Warning' -and
              $_.ProviderName -match 'Tcpip|Dhcp|NetBT|Dnscache|NDIS|WLAN|Netwtw|iaLM|e1[a-z]|rt[a-z]|Rtk|Realtek|Intel|Kernel-Power'
          }
Log 'NETWORK ERRORS AND WARNINGS' (
    $events | Select-Object -First 60 TimeCreated, ProviderName, Id,
        @{n='Message'; e={ ($_.Message -split "`n")[0] }} | Format-Table -Auto -Wrap)

# Group them so a repeating cause stands out from one-off noise.
$grouped = $events | Group-Object ProviderName, Id |
           Sort-Object Count -Descending | Select-Object -First 12 Count, Name
Log 'MOST FREQUENT NETWORK EVENTS' ($grouped | Format-Table -Auto)

# --- Windows' own Wi-Fi report ---------------------------------------
Write-Host "  . generating Wi-Fi report" -ForegroundColor DarkGray
netsh wlan show wlanreport | Out-Null
$wlanReport = "C:\ProgramData\Microsoft\Windows\WlanReport\wlan-report-latest.html"


# ---------------------------------------------------------------------
Write-Host "`n===================== RESULT =====================" -ForegroundColor Cyan

if ($sleepy) {
    Write-Host "`n  LIKELY CAUSE FOUND" -ForegroundColor Yellow
    Write-Host "  Windows is allowed to switch off these adapters to save power:" -ForegroundColor Yellow
    $sleepy | ForEach-Object { Write-Host ("    - " + $_.Name) -ForegroundColor Yellow }
    Write-Host "  That causes exactly the 'drops now and then, comes back' symptom." -ForegroundColor DarkGray
    Write-Host "  Fix: Device Manager -> the adapter -> Properties -> Power Management" -ForegroundColor DarkGray
    Write-Host "       -> untick 'Allow the computer to turn off this device'.`n" -ForegroundColor DarkGray
}

if ($grouped) {
    Write-Host "`n  Most frequent network events in the log:" -ForegroundColor Cyan
    $grouped | ForEach-Object { Write-Host ("    {0,5}x  {1}" -f $_.Count, $_.Name) -ForegroundColor DarkGray }
}

Write-Host "`n  Full report:  $report" -ForegroundColor Cyan
Write-Host "  Wi-Fi report: $wlanReport" -ForegroundColor Cyan
Write-Host "`n  The Wi-Fi report is the useful one - it graphs every disconnect" -ForegroundColor DarkGray
Write-Host "  over the last 3 days and gives a reason for each.`n" -ForegroundColor DarkGray

if (Test-Path $wlanReport) { Start-Process $wlanReport }
notepad $report
Read-Host "Press Enter to close"
