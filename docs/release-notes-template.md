<!-- Generated from CHANGELOG.md. Review before publishing. -->

## Changes

{{CHANGES}}

## Requirements

- Windows 10 or 11 x64
- Forza Horizon 6 with Data Out set to `127.0.0.1` and UDP port `5301`
- Internet connection during setup only if Microsoft Edge WebView2 Runtime is missing

## Install

1. Download `FDC-setup.exe` or `FDC_{{VERSION}}_x64-setup.exe` from this release.
2. Download `FDC-setup.exe.sha256` into the same folder, type `powershell` in File Explorer's address bar to open PowerShell there, and run the check. It prints `True` when the installer matches:
   ```powershell
   (Get-FileHash .\FDC-setup.exe).Hash.ToLower() -eq (Get-Content .\FDC-setup.exe.sha256).Split(' ')[0]
   ```
3. Run the installer. SmartScreen may show "Windows protected your PC" — click **More info** → **Run anyway** after the checksum matches.
4. Administrator approval is required. The installer shows "Unknown publisher".
5. Installation is available to all Windows users and defaults to `C:\Program Files\FDC`.

## Privacy

FDC receives Data Out from the local game session and keeps runtime data local. Garage, Events, Driver Analysis, and Shift Light data are stored in `fdc.sqlite` under `%APPDATA%\FDC`.

**Full Changelog**: https://github.com/kv199/fdc-application/compare/{{PREVIOUS_TAG}}...v{{VERSION}}
