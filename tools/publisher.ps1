param([Parameter(ValueFromRemainingArguments=$true)][string[]]$PublishArgs)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$pythonCandidates=@()
if($env:STUDY_PYTHON){$pythonCandidates+=$env:STUDY_PYTHON}
$pythonCandidates+=(Join-Path $projectRoot '.venv\Scripts\python.exe')
$pythonCandidates+=(Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
$pythonCommand=Get-Command python -ErrorAction SilentlyContinue
if($pythonCommand){$pythonCandidates+=$pythonCommand.Source}
$chosenPython=$pythonCandidates | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
if(!$chosenPython){throw 'Python 3.11+ not found; set STUDY_PYTHON to a working python.exe'}
$previousPythonPath=$env:PYTHONPATH
try {
  $env:PYTHONPATH=(Join-Path $projectRoot '.local\python-packages')
  if($previousPythonPath){$env:PYTHONPATH+=[IO.Path]::PathSeparator+$previousPythonPath}
  Push-Location $projectRoot
  try { & $chosenPython (Join-Path $PSScriptRoot 'publish.py') @PublishArgs; $publisherExitCode=$LASTEXITCODE }
  finally { Pop-Location }
} finally { $env:PYTHONPATH=$previousPythonPath }
if($publisherExitCode -ne 0){throw "Publisher exited with code $publisherExitCode"}
