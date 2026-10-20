#ifndef AppVersion
  #define AppVersion "0.2.0"
#endif
#ifndef StageDir
  #error StageDir is required. Use installer/build.ps1.
#endif
#ifndef ReleaseDir
  #error ReleaseDir is required.
#endif

[Setup]
AppId={{94D7F0AA-A8E4-4FA1-AB60-E579BCE62C54}
AppName=Market Lens Local
AppVersion={#AppVersion}
AppVerName=Market Lens Local {#AppVersion}
AppPublisher=Bikash543
AppPublisherURL=https://github.com/Bikash543/market-lens-local
AppSupportURL=https://github.com/Bikash543/market-lens-local/issues
AppUpdatesURL=https://github.com/Bikash543/market-lens-local/releases
DefaultDirName={localappdata}\Programs\Market Lens Local
DefaultGroupName=Market Lens Local
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
DisableProgramGroupPage=yes
WizardStyle=modern
SetupIconFile={#StageDir}\market-lens.ico
UninstallDisplayIcon={app}\MarketLens.exe
OutputDir={#ReleaseDir}
OutputBaseFilename=Market-Lens-Local-Setup-{#AppVersion}-x64
Compression=lzma2
SolidCompression=yes
CloseApplications=no
RestartApplications=no
Uninstallable=yes
VersionInfoVersion={#AppVersion}.0
VersionInfoDescription=Market Lens Local Windows installer
SetupLogging=yes

[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"
Name: startup; Description: "Collect market data in the background when I sign in to Windows"; GroupDescription: "Background collection:"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Market Lens Local"; Filename: "{app}\MarketLens.exe"; WorkingDir: "{app}"
Name: "{group}\Stop background collection"; Filename: "{app}\MarketLens.exe"; Parameters: "--stop"; WorkingDir: "{app}"
Name: "{group}\Getting started"; Filename: "{app}\Getting-started.html"
Name: "{autodesktop}\Market Lens Local"; Filename: "{app}\MarketLens.exe"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\Market Lens Local Desktop Background"; Filename: "{app}\MarketLens.exe"; Parameters: "--background --quiet"; WorkingDir: "{app}"; Tasks: startup

[Run]
Filename: "{app}\MarketLens.exe"; Parameters: "--background --quiet"; Flags: skipifsilent; Tasks: startup; StatusMsg: "Starting background collection..."
Filename: "{app}\MarketLens.exe"; Description: "Open Market Lens Local"; Flags: nowait postinstall skipifsilent

[Code]
function StopOwnedService(): Boolean;
var
  Launcher: String;
  ExitCode: Integer;
begin
  Result := True;
  Launcher := ExpandConstant('{app}\MarketLens.exe');
  if FileExists(Launcher) then
    Result := Exec(Launcher, '--stop-if-owned --quiet', ExpandConstant('{app}'),
      SW_HIDE, ewWaitUntilTerminated, ExitCode) and (ExitCode = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not StopOwnedService() then
    Result := 'Market Lens is still stopping. Close its background service and try again.';
end;

function InitializeUninstall(): Boolean;
begin
  Result := StopOwnedService();
  if not Result then
    MsgBox('Could not stop this installation. Use Stop background collection and try again.', mbError, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    { Remove only this installer's old startup shortcut when the task is deselected. }
    if not WizardIsTaskSelected('startup') then
      DeleteFile(ExpandConstant('{userstartup}\Market Lens Local Desktop Background.lnk'));
  end;
end;
