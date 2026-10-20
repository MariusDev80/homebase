# Toolchain Windows

Vérifiée le 2026-10-20 sur le PC de Marius (Windows 11 Pro 10.0.26200).

| Outil | Version constatée | Exigence | Vérification |
|---|---|---|---|
| Rust | 1.99.0, toolchain `stable-x86_64-pc-windows-msvc` | ≥ 1.90 (`tauri-plugin-sql`), cible MSVC | `rustc --version`, `rustup show active-toolchain` |
| Cargo | 1.99.0 | livré avec Rust | `cargo --version` |
| Build Tools C++ | Visual Studio Build Tools 2022 (composant VC.Tools.x86.x64) | requis par la cible MSVC | `vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64` |
| WebView2 | 155.0.4283.62 (Evergreen) | présent sur Windows 11 | registre `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}` |
| Node.js | 24.20.0 | LTS compatible Angular 21 | `node --version` |
| npm | 11.19.0 | gestionnaire de paquets du projet (pas de pnpm) | `npm --version` |
| Git | 2.55.0.windows.3 | | `git --version` |
| GitHub CLI | 2.102.0 | | `gh --version` |

## Installation sur un nouveau poste
1. Visual Studio Build Tools 2022 avec la charge « Développement Desktop en C++ ».
2. Rust via `rustup` (toolchain stable MSVC par défaut).
3. Node.js LTS (≥ 24).
4. WebView2 : déjà présent sur Windows 11 ; sinon runtime Evergreen.
