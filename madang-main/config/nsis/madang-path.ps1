# Adds or removes one directory in the current user's PATH, keeping the value type (expandable stays expandable).
param(
  [Parameter(Mandatory = $true)][ValidateSet('add', 'remove')][string]$Action,
  [Parameter(Mandatory = $true)][string]$Dir,
  # Only tests pass another key.
  [string]$SubKey = 'Environment'
)
$ErrorActionPreference = 'Stop'
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($SubKey)
$current = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$kind = 'ExpandString'
if ($null -ne $key.GetValue('Path', $null)) { $kind = $key.GetValueKind('Path') }
$wanted = $Dir.TrimEnd('\')
$parts = @($current -split ';' | Where-Object { $_ -ne '' -and $_.TrimEnd('\') -ine $wanted })
if ($Action -eq 'add') { $parts += $wanted }
$key.SetValue('Path', ($parts -join ';'), $kind)
$key.Close()
