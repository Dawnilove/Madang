//! Launches the Madang CLI by running the packaged Electron binary as Node.
//!
//! Why a native binary rather than the `.cmd` alone: `cmd.exe` reparses `%*` and
//! executes or truncates embedded newlines, so orchestration message bodies
//! cannot survive it (#8374). `madang.cmd` refuses those subcommands and defers
//! here.
//!
//! Why not a managed assembly: a small freshly-compiled MSIL image in a
//! user-writable directory that mutates environment variables and proxies a
//! child process is the shape antivirus MSIL heuristics are trained on, and it
//! was flagged as exactly that across several vendors (#23383).
//!
//! On a Windows server host, madangd copies this binary into its profile and
//! writes `madang-launcher.cfg` beside it; that file selects the server mode.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{exit, Command};

const SERVER_CONFIG_FILENAME: &str = "madang-launcher.cfg";

#[cfg(windows)]
mod administrator_status;

fn main() {
    #[cfg(windows)]
    administrator_status::run_if_requested();
    let launcher = match env::current_exe() {
        Ok(path) => path,
        Err(error) => fail(&format!("Unable to start the Madang CLI: {error}")),
    };
    if let Some(config) = launcher
        .parent()
        .map(|directory| directory.join(SERVER_CONFIG_FILENAME))
        .filter(|config| config.is_file())
    {
        run_server_cli(&config);
    }

    let Some(resources_directory) = launcher.parent().and_then(Path::parent) else {
        fail(&format!(
            "Unable to locate Madang.exe next to \"{}\"",
            launcher.display()
        ))
    };
    let Some(app_directory) = resources_directory.parent() else {
        fail(&format!(
            "Unable to locate Madang.exe next to \"{}\"",
            resources_directory.display()
        ))
    };

    let electron_path = app_directory.join("Madang.exe");
    if !electron_path.is_file() {
        fail(&format!(
            "Unable to locate Madang.exe next to \"{}\"",
            resources_directory.display()
        ));
    }

    let cli_path: PathBuf = resources_directory
        .join("app.asar.unpacked")
        .join("out")
        .join("cli")
        .join("index.js");
    if !cli_path.is_file() {
        fail(&format!(
            "Unable to locate the Madang CLI entrypoint at \"{}\"",
            cli_path.display()
        ));
    }

    // Preserve duplicate PATH/Path entries by inheriting this process’s environment verbatim; an explicit map broke #12046.
    move_environment_variable("NODE_OPTIONS", "NODE_OPTIONS");
    move_environment_variable("NODE_REPL_EXTERNAL_MODULE", "NODE_REPL_EXTERNAL_MODULE");
    env::set_var("ELECTRON_RUN_AS_NODE", "1");
    set_madang_variable("WINDOWS_PACKAGED_CLI_LAUNCHER", "1");
    let requested_command = madang_variable("CLI_COMMAND");
    set_madang_variable(
        "CLI_COMMAND",
        if requested_command == "madang-ide" {
            "madang-ide"
        } else {
            "madang"
        },
    );

    run_cli(&electron_path, &cli_path)
}

/// The server mode: the pinned Node runs the active slot's CLI under the
/// server's profile, as the POSIX launcher does.
fn run_server_cli(config_path: &Path) -> ! {
    let config = fs::read_to_string(config_path).unwrap_or_else(|error| {
        fail(&format!(
            "Unable to read the Madang CLI configuration at \"{}\": {error}",
            config_path.display()
        ))
    });
    let node_path = PathBuf::from(config_value(&config, "node", config_path));
    let cli_path = PathBuf::from(config_value(&config, "cli", config_path));
    let user_data_path = config_value(&config, "user-data", config_path);
    for path in [&node_path, &cli_path] {
        if !path.is_file() {
            fail(&format!(
                "Unable to locate \"{}\"; reconnect to the Madang server to refresh the CLI",
                path.display()
            ));
        }
    }
    set_madang_variable("USER_DATA_PATH", user_data_path);
    for name in [
        "NODE_OPTIONS",
        "NODE_REPL_EXTERNAL_MODULE",
        "ELECTRON_RUN_AS_NODE",
    ] {
        env::remove_var(name);
    }
    // A server started by the desktop's `madang serve` inherits this marker, which would make
    // orchestration demand a bare `madang` resume command.
    clear_madang_variable("WINDOWS_PACKAGED_CLI_LAUNCHER");
    run_cli(&node_path, &cli_path)
}

fn config_value<'a>(config: &'a str, key: &str, config_path: &Path) -> &'a str {
    config
        .lines()
        .find_map(|line| {
            line.split_once('=')
                .filter(|(name, value)| *name == key && !value.is_empty())
                .map(|(_, value)| value)
        })
        .unwrap_or_else(|| {
            fail(&format!(
                "The Madang CLI configuration at \"{}\" has no {key}",
                config_path.display()
            ))
        })
}

fn run_cli(program: &Path, cli_path: &Path) -> ! {
    // Each argument stays its own argv entry, so a body holding newlines reaches
    // the CLI intact.
    let mut command = Command::new(program);
    command.arg(cli_path).args(env::args_os().skip(1));

    match command.status() {
        Ok(status) => exit(status.code().unwrap_or(1)),
        Err(error) => fail(&format!("Unable to start the Madang CLI: {error}")),
    }
}

fn move_environment_variable(source_name: &str, target_suffix: &str) {
    match env::var_os(source_name) {
        // A missing source clears the target, so a stale value cannot leak in.
        None => clear_madang_variable(target_suffix),
        Some(value) => {
            env::remove_var(source_name);
            clear_madang_variable(target_suffix);
            env::set_var(format!("MADANG_{target_suffix}"), value);
        }
    }
}

/// MADANG_<suffix> if set and non-empty, else the Orca-era ORCA_<suffix> an older caller exports.
fn madang_variable(suffix: &str) -> String {
    for prefix in ["MADANG_", "ORCA_"] {
        if let Ok(value) = env::var(format!("{prefix}{suffix}")) {
            if !value.is_empty() {
                return value;
            }
        }
    }
    String::new()
}

/// Sets MADANG_<suffix> and drops ORCA_<suffix>, which the CLI would otherwise copy over a stale value.
fn set_madang_variable(suffix: &str, value: &str) {
    env::remove_var(format!("ORCA_{suffix}"));
    env::set_var(format!("MADANG_{suffix}"), value);
}

fn clear_madang_variable(suffix: &str) {
    env::remove_var(format!("MADANG_{suffix}"));
    env::remove_var(format!("ORCA_{suffix}"));
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    exit(1)
}
