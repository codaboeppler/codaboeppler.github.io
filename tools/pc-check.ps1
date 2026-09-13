<#
=====================================================================
 pc-check.ps1  --  Windows ownership & integrity check
=====================================================================

 WHAT THIS IS FOR
   Answers the question "does someone else still control this PC?"
   That is a different question from "does this PC have a virus", and
   it is usually the one that matters when a machine was set up or
   maintained by someone you no longer trust. Antivirus will not find
   a second admin account, a remote-support agent, a management
   enrollment or a traffic-intercepting certificate, because none of
   those are malware -- they are legitimate tools doing their job for
   somebody else.

 WHAT IT DOES
   Reads settings and reports on them. It is READ-ONLY:
   it does not delete, install, disable, or change anything.
   Every command below is a "Get", a registry read, or a log query.

 HOW TO RUN
   Right-click -> "Run with PowerShell", or from an admin PowerShell:
       powershell -ExecutionPolicy Bypass -File .\pc-check.ps1
   It will ask for admin rights (needed to read the security log and
   machine-wide settings) and re-launch itself elevated.

 OUTPUT
   A colour-coded summary in the window, and a full report saved to
   your Desktop as pc-check.txt

 HOW TO READ THE RESULT
   SERIOUS  someone other than you may have access. Act on it.
   CHECK    unusual, but has innocent explanations. Worth understanding.
   nothing  good -- none of the standard control mechanisms are present.
=====================================================================
#>

# ---- re-launch elevated if needed ------------------------------------
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]'Administrator')) {
    Write-Host "This check needs Administrator rights. Re-launching..." -ForegroundColor Yellow
    Start-Process powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$ErrorActionPreference = 'SilentlyContinue'
$report   = "$env:USERPROFILE\Desktop\pc-check.txt"
$findings = New-Object System.Collections.Generic.List[object]
$me       = $env:USERNAME
$builtin  = 'Administrator|Guest|DefaultAccount|WDAGUtilityAccount'

function Flag($level, $what, $detail) {
    $findings.Add([pscustomobject]@{
        Level   = $level
        Finding = $what
        Detail  = (($detail | Where-Object { $_ }) -join '; ')
    })
}
function Log($title, $output) {
    "`n`n########## $title ##########" | Out-File $report -Append -Encoding utf8
    ($output | Out-String -Width 300)  | Out-File $report -Append -Encoding utf8
}
function Step($m) { Write-Host "  . $m" -ForegroundColor DarkGray }

"WINDOWS OWNERSHIP & INTEGRITY CHECK"          | Out-File $report -Encoding utf8
"Run: $(Get-Date)  Computer: $env:COMPUTERNAME  User: $me" | Out-File $report -Append -Encoding utf8

Write-Host "`nRunning ownership & integrity check (about a minute)...`n" -ForegroundColor Cyan


# ---------------------------------------------------------------------
# 1. ACCOUNTS -- who can log in, and who is an administrator
#    The single most useful check. An admin account you cannot name
#    is standing access that survives every antivirus scan.
# ---------------------------------------------------------------------
Step 'user accounts and administrators'
$users = Get-LocalUser
Log 'LOCAL USER ACCOUNTS' ($users | Select-Object Name, Enabled, LastLogon, Description | Format-Table -Auto)

try   { $admins = Get-LocalGroupMember -Group 'Administrators' | Select-Object -Expand Name }
catch { $admins = net localgroup administrators | Select-Object -Skip 6 |
                  Where-Object { $_ -and $_ -notmatch 'completed successfully' } }
Log 'ADMINISTRATORS GROUP' $admins

$extraAdmins = $admins | Where-Object {
    ($_ -split '\\')[-1] -ne $me -and ($_ -split '\\')[-1] -notmatch $builtin
}
if ($extraAdmins) { Flag 'SERIOUS' 'Administrator account(s) other than you' $extraAdmins }

$otherEnabled = $users | Where-Object { $_.Enabled -and $_.Name -ne $me -and $_.Name -notmatch $builtin }
if ($otherEnabled) { Flag 'CHECK' 'Other enabled local accounts' $otherEnabled.Name }

if ($users | Where-Object { $_.Name -eq 'Administrator' -and $_.Enabled }) {
    Flag 'CHECK' 'Built-in Administrator account is ENABLED' 'Normally disabled on home PCs'
}


# ---------------------------------------------------------------------
# 2. REMOTE ACCESS -- can somebody drive this PC from elsewhere?
# ---------------------------------------------------------------------
Step 'remote access and remote-management software'
$rdp = (Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections).fDenyTSConnections
Log 'REMOTE DESKTOP (0 = enabled, 1 = disabled)' $rdp
if ($rdp -eq 0) { Flag 'SERIOUS' 'Remote Desktop is ENABLED' 'Permits remote login to this PC' }

# Remote-support tools and IT "RMM" agents. All legitimate products --
# the problem is one being here that nobody in the house uses.
$rat = 'teamviewer|anydesk|logmein|gotoassist|screenconnect|connectwise|splashtop|' +
       'realvnc|tightvnc|ultravnc|ammyy|supremo|dwservice|rustdesk|remotepc|' +
       'kaseya|atera|ninjarmm|ninjaone|syncro|datto|n-able|solarwinds|radmin|' +
       'remote utilities|action1|pulseway|gotomypc|zoho assist|bomgar|beyondtrust|itarian|comodo one'

$uninstallKeys = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
                 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
$installed = Get-ItemProperty $uninstallKeys | Where-Object DisplayName |
             Select-Object DisplayName, Publisher, InstallDate
Log 'ALL INSTALLED PROGRAMS' ($installed | Sort-Object DisplayName | Format-Table -Auto)

$services = Get-CimInstance Win32_Service
$hits = @(($installed | Where-Object { $_.DisplayName -match $rat }).DisplayName) +
        @(($services  | Where-Object { $_.Name -match $rat -or $_.DisplayName -match $rat -or $_.PathName -match $rat }).DisplayName) +
        @((Get-Process | Where-Object { $_.Name -match $rat }).Name) |
        Where-Object { $_ } | Select-Object -Unique
Log 'REMOTE-ACCESS / RMM MATCHES' $hits
if ($hits) { Flag 'SERIOUS' 'Remote-access or remote-management software installed' $hits }


# ---------------------------------------------------------------------
# 3. ANTIVIRUS -- is it on, and has anything been hidden from it?
#    Exclusions are the giveaway: an excluded folder will report clean
#    forever no matter what is inside it.
# ---------------------------------------------------------------------
Step 'antivirus status and exclusions'
$mp   = Get-MpComputerStatus
$pref = Get-MpPreference
Log 'DEFENDER STATUS' ($mp | Select-Object AntivirusEnabled, RealTimeProtectionEnabled,
                                           IsTamperProtected, AntivirusSignatureLastUpdated)

$exclusions = @($pref.ExclusionPath) + @($pref.ExclusionProcess) + @($pref.ExclusionExtension) |
              Where-Object { $_ }
Log 'DEFENDER EXCLUSIONS (should normally be empty)' $exclusions
if ($exclusions) { Flag 'SERIOUS' 'Antivirus scan exclusions are set' $exclusions }

if ($mp -and -not $mp.RealTimeProtectionEnabled) {
    Flag 'SERIOUS' 'Defender real-time protection is OFF' 'Normal if another antivirus is installed - check the programs list'
}
if ($mp -and -not $mp.IsTamperProtected) {
    Flag 'CHECK' 'Defender Tamper Protection is OFF' 'Lets software silently change AV settings'
}


# ---------------------------------------------------------------------
# 4. CERTIFICATES -- can anyone read this machine's HTTPS traffic?
#    A private root certificate in the trust store means whoever holds
#    the matching key can decrypt banking, email, everything.
# ---------------------------------------------------------------------
Step 'trusted root certificates'
$knownCAs = 'Microsoft|VeriSign|DigiCert|Thawte|Baltimore|GlobalSign|Entrust|Go ?Daddy|Symantec|' +
            'COMODO|Sectigo|USERTrust|Starfield|AddTrust|Certum|QuoVadis|SecureTrust|Amazon|ISRG|' +
            'DST Root|Root Agency|Actalis|Buypass|D-TRUST|IdenTrust|SSL\.com|NetLock|Microsec|' +
            'Security Communication|Camerfirma|AAA Certificate|Hellenic|GeoTrust|RSA Security|' +
            'Certainly|TeliaSonera|T-TeleSec|SwissSign|Izenpe|Firmaprofesional|OISTE|TrustCor|' +
            'Telekom|Google Trust|Certigna|E-Tugra|emSign|HARICA|Sponsored by|DoD |U\.S\. Government'
$oddCerts = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -notmatch $knownCAs }
Log 'NON-STANDARD ROOT CERTIFICATES' ($oddCerts | Select-Object Subject, NotAfter, Thumbprint | Format-List)
if ($oddCerts) {
    Flag 'SERIOUS' 'Non-standard root certificate trusted (can decrypt your HTTPS)' $oddCerts.Subject
}


# ---------------------------------------------------------------------
# 5. DEVICE MANAGEMENT -- is this PC enrolled to an organisation?
# ---------------------------------------------------------------------
Step 'device management / MDM enrollment'
$dsreg = dsregcmd /status
Log 'DEVICE REGISTRATION (dsregcmd)' $dsreg
if ($dsreg -match 'AzureAdJoined\s*:\s*YES') { Flag 'CHECK' 'Joined to a work/school organisation (Azure AD)' '' }
if ($dsreg -match 'DomainJoined\s*:\s*YES')  { Flag 'CHECK' 'Joined to a Windows domain' '' }

$enrollments = Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Enrollments' |
               ForEach-Object { Get-ItemProperty $_.PSPath } |
               Where-Object { $_.UPN -or $_.ProviderID }
Log 'MDM ENROLLMENTS' ($enrollments | Select-Object PSChildName, UPN, ProviderID, EnrollmentType | Format-Table -Auto)
if ($enrollments) {
    Flag 'CHECK' 'Device-management (MDM) enrollment present' (@($enrollments.ProviderID) + @($enrollments.UPN) | Where-Object { $_ } | Select-Object -Unique)
}


# ---------------------------------------------------------------------
# 6. NETWORK CONFIGURATION -- is traffic being redirected?
# ---------------------------------------------------------------------
Step 'hosts file, DNS and proxy'
$hostsEntries = Get-Content C:\Windows\System32\drivers\etc\hosts |
                Where-Object { $_ -notmatch '^\s*#' -and $_.Trim() }
Log 'HOSTS FILE ENTRIES' $hostsEntries
if ($hostsEntries) { Flag 'CHECK' 'Hosts file contains redirects' $hostsEntries }

$dns = Get-DnsClientServerAddress -AddressFamily IPv4 |
       Where-Object { $_.ServerAddresses -and (Get-NetAdapter -InterfaceIndex $_.InterfaceIndex).Status -eq 'Up' }
Log 'DNS SERVERS IN USE' ($dns | Select-Object InterfaceAlias, ServerAddresses | Format-Table -Auto)

# Private ranges (your router) plus the well-known public resolvers.
$knownDns = '^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\.|^127\.0\.0\.1$|' +
            '^1\.1\.1\.1$|^1\.0\.0\.1$|^8\.8\.8\.8$|^8\.8\.4\.4$|^9\.9\.9\.9$|' +
            '^149\.112\.112\.|^208\.67\.22[02]\.|^76\.76\.2\.|^94\.140\.1[45]\.|^185\.228\.16[89]\.'
$oddDns = $dns.ServerAddresses | Where-Object { $_ -notmatch $knownDns } | Select-Object -Unique
if ($oddDns) { Flag 'CHECK' 'Unusual DNS server configured' $oddDns }

$proxy = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Log 'PROXY SETTINGS' (@((netsh winhttp show proxy),
                        ($proxy | Select-Object ProxyEnable, ProxyServer, AutoConfigURL | Out-String)))
if ($proxy.ProxyEnable -eq 1 -or $proxy.AutoConfigURL) {
    Flag 'CHECK' 'A web proxy is configured' "$($proxy.ProxyServer) $($proxy.AutoConfigURL)"
}


# ---------------------------------------------------------------------
# 7. PERSISTENCE -- what runs automatically, and from where?
#    Legitimate software runs from Program Files. Things running from
#    AppData, Temp or Public are worth explaining.
# ---------------------------------------------------------------------
Step 'startup items, scheduled tasks and services'
$wmiSubs = Get-CimInstance -Namespace root\Subscription -ClassName __FilterToConsumerBinding |
           Where-Object { $_.Consumer -notmatch 'SCM Event Log Consumer|BVTConsumer' }
Log 'WMI EVENT SUBSCRIPTIONS (should normally be empty)' ($wmiSubs | Out-String)
if ($wmiSubs) { Flag 'SERIOUS' 'WMI event-subscription persistence found' "$($wmiSubs.Count) binding(s)" }

$suspiciousPath = '\\AppData\\|\\Temp\\|\\Users\\Public\\|-enc |-w hidden|-windowstyle hidden|mshta|rundll32.*http'

$tasks = Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' }
$taskLines = $tasks | ForEach-Object {
    "{0}{1} [{2}] author={3} -> {4} {5}" -f $_.TaskPath, $_.TaskName, $_.State, $_.Author,
                                            ($_.Actions.Execute -join ';'), ($_.Actions.Arguments -join ';')
}
Log 'NON-MICROSOFT SCHEDULED TASKS' $taskLines
$badTasks = $taskLines | Where-Object { $_ -match $suspiciousPath }
if ($badTasks) { Flag 'CHECK' 'Scheduled task running from a temp/user folder' $badTasks }

$startup = Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location, User
Log 'STARTUP ITEMS' ($startup | Format-Table -Auto)
$badStartup = ($startup | Where-Object { $_.Command -match $suspiciousPath }).Command
if ($badStartup) { Flag 'CHECK' 'Startup item running from a temp/user folder' $badStartup }

Log 'NON-MICROSOFT AUTO-START SERVICES' (
    $services | Where-Object { $_.StartMode -eq 'Auto' -and $_.PathName -notmatch '\\Windows\\' } |
    Select-Object Name, DisplayName, State, PathName | Format-Table -Auto)

Log 'CUSTOM INBOUND FIREWALL RULES' (
    Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True |
    Where-Object { -not $_.Group } | Select-Object DisplayName, Profile | Format-Table -Auto)


# ---------------------------------------------------------------------
# 8. BROWSER EXTENSIONS and REMOTE LOGIN HISTORY
# ---------------------------------------------------------------------
Step 'browser extensions and login history'
'Google\Chrome', 'Microsoft\Edge', 'BraveSoftware\Brave-Browser' | ForEach-Object {
    $path = "$env:LOCALAPPDATA\$_\User Data\Default\Extensions"
    if (Test-Path $path) {
        Log "BROWSER EXTENSIONS - $_" (
            Get-ChildItem $path | ForEach-Object {
                Get-ChildItem $_.FullName | ForEach-Object {
                    $manifest = "$($_.FullName)\manifest.json"
                    if (Test-Path $manifest) { (Get-Content $manifest -Raw | ConvertFrom-Json).name }
                }
            })
    }
}

# Logon type 10 = an interactive login over Remote Desktop.
$remoteLogons = Get-WinEvent -FilterHashtable @{
    LogName = 'Security'; Id = 4624; StartTime = (Get-Date).AddDays(-30)
} | Where-Object { $_.Message -match 'Logon Type:\s+10' }
Log 'REMOTE DESKTOP LOGINS (last 30 days)' (
    $remoteLogons | Select-Object -First 50 | ForEach-Object {
        "{0} | {1}" -f $_.TimeCreated,
            ((($_.Message -split "`n") | Where-Object { $_ -match 'Account Name|Source Network Address' }) -join ' ')
    })
if ($remoteLogons) {
    Flag 'SERIOUS' 'Remote Desktop logins recorded in the last 30 days' "$($remoteLogons.Count) events - see report"
}


# ---------------------------------------------------------------------
# RESULT
# ---------------------------------------------------------------------
Log 'SUMMARY OF FINDINGS' ($findings | Format-Table -Auto)

Write-Host "`n===================== RESULT =====================" -ForegroundColor Cyan
if ($findings.Count -eq 0) {
    Write-Host "`n  CLEAN - none of the standard control mechanisms are present.`n" -ForegroundColor Green
    Write-Host "  No foreign admin account, no remote-access software, no" -ForegroundColor Green
    Write-Host "  management enrollment, no traffic interception.`n"       -ForegroundColor Green
} else {
    foreach ($level in 'SERIOUS', 'CHECK') {
        $set = $findings | Where-Object Level -eq $level
        if ($set) {
            $colour = @{ SERIOUS = 'Red'; CHECK = 'Yellow' }[$level]
            Write-Host "`n--- $level ---" -ForegroundColor $colour
            $set | ForEach-Object {
                Write-Host ("  * " + $_.Finding) -ForegroundColor $colour
                if ($_.Detail) { Write-Host ("      " + $_.Detail) -ForegroundColor DarkGray }
            }
        }
    }
    Write-Host ""
}
Write-Host "Full report saved to: $report`n" -ForegroundColor Cyan

notepad $report
Read-Host "Press Enter to close"
