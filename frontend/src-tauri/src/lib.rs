use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_fs::FsExt;
use tauri_plugin_opener::OpenerExt;

fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn ensure_writable_directory(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| format!("无法创建数据库目录：{error}"))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let probe = directory.join(format!(
        ".zhixu-db-write-{}-{timestamp}",
        std::process::id()
    ));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|error| format!("数据库目录不可写：{error}"))?;
    drop(file);
    fs::remove_file(&probe).map_err(|error| format!("无法清理数据库目录测试文件：{error}"))?;
    Ok(())
}

fn preferred_database_path() -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let frontend_dir = manifest_dir
            .parent()
            .ok_or_else(|| "无法解析桌面端工程目录".to_string())?;
        let workspace_dir = frontend_dir
            .parent()
            .ok_or_else(|| "无法解析项目根目录".to_string())?;
        return Ok(workspace_dir.join("database").join("zhixu.db"));
    }

    #[cfg(not(debug_assertions))]
    {
        let executable =
            std::env::current_exe().map_err(|error| format!("无法读取程序路径：{error}"))?;
        let executable_dir = executable
            .parent()
            .ok_or_else(|| "无法解析程序安装目录".to_string())?;
        Ok(executable_dir.join("database").join("zhixu.db"))
    }
}

fn copy_database_bundle(source: &Path, target: &Path) -> Result<(), String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let marker = format!(".zhixu-migration-{}-{timestamp}", std::process::id());
    let temporary_main = path_with_suffix(target, &marker);
    let mut temporary_sidecars = Vec::new();

    let result = (|| {
        fs::copy(source, &temporary_main)
            .map_err(|error| format!("无法迁移本地数据库：{error}"))?;

        for suffix in ["-wal", "-shm"] {
            let source_sidecar = path_with_suffix(source, suffix);
            if source_sidecar.is_file() {
                let target_sidecar = path_with_suffix(target, suffix);
                let temporary_sidecar = path_with_suffix(&target_sidecar, &marker);
                fs::copy(&source_sidecar, &temporary_sidecar)
                    .map_err(|error| format!("无法迁移数据库辅助文件 {suffix}：{error}"))?;
                temporary_sidecars.push((temporary_sidecar, target_sidecar));
            }
        }

        if target.exists() {
            return Err("目标数据库已存在".to_string());
        }

        for (temporary_sidecar, target_sidecar) in &temporary_sidecars {
            if target_sidecar.exists() {
                fs::remove_file(target_sidecar)
                    .map_err(|error| format!("无法替换数据库辅助文件：{error}"))?;
            }
            fs::rename(temporary_sidecar, target_sidecar)
                .map_err(|error| format!("无法完成数据库辅助文件迁移：{error}"))?;
        }
        fs::rename(&temporary_main, target)
            .map_err(|error| format!("无法完成本地数据库迁移：{error}"))?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary_main);
        for (temporary_sidecar, _) in temporary_sidecars {
            let _ = fs::remove_file(temporary_sidecar);
        }
    }
    result
}

/// Resolve the SQLite file before the SQL plugin is initialized.
///
/// Development builds use `<workspace>/database/zhixu.db`; packaged builds
/// use `<installation>/database/zhixu.db`. A non-writable installation falls
/// back to Tauri's app-config directory so the app remains usable under
/// locations such as `C:\\Program Files`.
#[tauri::command]
fn resolve_database_path(app: tauri::AppHandle) -> Result<String, String> {
    let fallback_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("无法解析应用数据目录：{error}"))?;
    let fallback_database = fallback_dir.join("zhixu.db");
    let preferred_database = preferred_database_path()?;

    let preferred_directory = preferred_database
        .parent()
        .ok_or_else(|| "无法解析数据库目录".to_string())?;
    if let Err(error) = ensure_writable_directory(preferred_directory) {
        ensure_writable_directory(&fallback_dir)?;
        log::warn!(
            "安装目录不可写，SQLite 回退到 {:?}：{}",
            fallback_database,
            error
        );
        return Ok(fallback_database.to_string_lossy().into_owned());
    }

    if !preferred_database.exists() && fallback_database.is_file() {
        if let Err(error) = copy_database_bundle(&fallback_database, &preferred_database) {
            log::warn!(
                "无法迁移旧 SQLite 数据库，继续使用 {:?}：{}",
                fallback_database,
                error
            );
            return Ok(fallback_database.to_string_lossy().into_owned());
        }
    }

    Ok(preferred_database.to_string_lossy().into_owned())
}

#[tauri::command]
fn prepare_knowledge_directory(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let requested = path.trim();
    if requested.is_empty() {
        return Err("知识库文件目录不能为空".to_string());
    }
    let path = PathBuf::from(requested);
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map_err(|error| format!("无法读取当前目录：{error}"))?
            .join(path)
    };
    std::fs::create_dir_all(&absolute).map_err(|error| format!("无法创建知识库目录：{error}"))?;
    let resolved = absolute
        .canonicalize()
        .map_err(|error| format!("无法解析知识库目录：{error}"))?;
    app.fs_scope()
        .allow_directory(&resolved, true)
        .map_err(|error| format!("无法授权知识库目录：{error}"))?;
    Ok(resolved.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_local_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let resolved = path
        .canonicalize()
        .map_err(|error| format!("无法读取本机文件：{error}"))?;
    if !resolved.is_file() {
        return Err("本机文件不存在".to_string());
    }
    app.opener()
        .open_path(resolved.to_string_lossy().into_owned(), None::<String>)
        .map_err(|error| format!("无法使用系统程序打开文件：{error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            prepare_knowledge_directory,
            open_local_file,
            resolve_database_path
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
