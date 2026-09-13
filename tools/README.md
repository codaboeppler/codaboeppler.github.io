# PC check tools

Two read-only Windows diagnostic scripts. They report on settings; they do not
change, delete, disable or install anything. Every command in them is a `Get-*`,
a registry read, or an event-log query — you can read the source and confirm it.

These live on a branch and are not part of the published website.

| Script | Question it answers |
|---|---|
| `pc-check.ps1` | Does anyone other than the owner still have control of this PC? |
| `pc-network.ps1` | Why does the internet keep dropping? |

## Running them

Download both to the Desktop, then from any PowerShell window:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Desktop\pc-check.ps1"
```

Each script requests Administrator rights and re-launches itself elevated —
needed to read the security event log and machine-wide settings. Results print
to the window and save to the Desktop as a `.txt` file.

## What `pc-check.ps1` looks at

It checks for *retained control*, which is a different question from "is there a
virus". When a machine was set up or maintained by someone no longer trusted,
the risk is rarely malware — it is ordinary, legitimate software still doing its
job for somebody else. Antivirus will not flag any of the following, because
none of it is malicious:

- **Accounts** — administrators other than you, unexpected enabled accounts, the
  built-in Administrator account left switched on.
- **Remote access** — Remote Desktop enabled, and ~30 remote-support and IT
  management agents (TeamViewer, AnyDesk, ScreenConnect, Splashtop, Kaseya,
  Atera, NinjaOne and similar).
- **Antivirus integrity** — real-time protection disabled, tamper protection
  off, and scan *exclusions*, which make an excluded folder report clean forever
  regardless of contents.
- **Certificates** — non-standard root certificates, which allow whoever holds
  the matching private key to decrypt the machine's HTTPS traffic.
- **Device management** — Azure AD join, domain join, MDM enrollment.
- **Traffic redirection** — hosts-file entries, unusual DNS servers, configured
  web proxies and auto-config URLs.
- **Persistence** — WMI event subscriptions, non-Microsoft scheduled tasks and
  startup items running from temp or user folders, custom inbound firewall
  rules, browser extensions.
- **History** — Remote Desktop logins in the last 30 days, with source address.

Findings are graded:

- **SERIOUS** — someone other than the owner may have access.
- **CHECK** — unusual, but has innocent explanations worth confirming.
- **(nothing)** — none of the standard control mechanisms are present.

Two known false alarms: *"Defender real-time protection is OFF"* is expected
when a third-party antivirus is installed, and a long list of scheduled tasks is
normal — Windows and ordinary applications create many.

## What `pc-network.ps1` looks at

Adapter status and driver versions, adapter power management (a very common
cause of intermittent drops), Wi-Fi signal and saved profiles, DHCP lease, and
network errors in the system event log grouped by frequency so a repeating cause
stands out from one-off noise.

It also generates Windows' own Wi-Fi report at
`C:\ProgramData\Microsoft\Windows\WlanReport\wlan-report-latest.html` — a
timeline of every disconnect over the last three days with a reason for each.
That is usually the most informative output.

## A note on scope

A clean result from `pc-check.ps1` is a stronger statement than a clean
antivirus scan, but it is not proof of a clean machine. If it reports an
administrator account you cannot account for, a management agent, or a foreign
root certificate, the reliable fix is a clean Windows reinstall rather than
removing findings one at a time — you cannot verify you got everything out of a
system someone else configured. Back up documents first; Settings → System →
Recovery → Reset this PC → Remove everything → Cloud download takes about an
hour.

Check the router too. It is a separate computer with its own admin password, and
a router someone else still has credentials to outlasts any amount of cleanup on
the PC.
