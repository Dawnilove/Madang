# Madang (마당)

AI 코딩 에이전트(Claude Code, Codex 등)를 작업별로 나누어 돌리는 데스크톱 앱이다. 채팅 중심 화면, 한국어 화면, 에이전트 협업 라우팅을 제공한다.

> Madang은 오픈소스 [Orca](https://github.com/stablyai/orca)(MIT 라이선스, Copyright (c) 2026 Lovecast Inc.)를 바탕으로 만들었다. 원본의 저작권 고지는 [LICENSE](LICENSE)에 그대로 있다.

## 설치 (Windows)

1. [Releases](https://github.com/Dawnilove/Madang/releases)에서 `madang-windows-setup.exe`를 받는다.
2. 설치 파일을 실행한다.
3. 서명이 없는 시험판이라 Windows SmartScreen 경고가 뜬다. **추가 정보** → **실행**을 누른다.

## 처음 쓰기

1. Madang을 연다.
2. **프로젝트 추가**로 git 저장소를 고른다.
3. 첫 화면 입력창에 요청을 쓰고 Enter를 누른다. 새 작업이 만들어지고 에이전트가 시작한다.
4. Claude Code 또는 Codex가 이 PC에 설치되어 있고 로그인되어 있어야 한다.

## 소스에서 실행

필요한 것: Git, Node.js 24, pnpm 12 (`corepack enable`), Bun 1.4.4. 경로가 길면 설치가 실패하므로 `C:\m` 같은 짧은 경로에 받는다.

```powershell
pnpm install
pnpm dev
```

설치 파일 만들기: Rust(`cargo`)와 Visual Studio Build Tools가 필요하다. 첫 시도에서 `mobile/`을 따로 설치해야 할 수 있다.

```powershell
cd mobile; pnpm install --frozen-lockfile; cd ..
pnpm build:win
```

## 개인정보

Madang은 사용 통계를 보내지 않는다. 피드백과 오류 보고는 이 PC에 저장하고, 사용자가 GitHub 이슈로 직접 보낸다.

## 라이선스

MIT. 원본 Orca의 저작권 고지를 유지한다. 자세한 내용은 [LICENSE](LICENSE)를 본다.
