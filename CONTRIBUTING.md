# Contributing to API_Hashira

First off, thank you for considering contributing to **Hashira**! Projects like this thrive because of developers like you who take the time to submit issues, refine features, and craft documentation.

---

## 🧭 Code of Conduct

By participating in this project, you agree to abide by respectful and constructive collaboration standards:
- **Respectful Communication**: Treat all contributors and community members with empathy and dignity.
- **Constructive Feedback**: Offer thoughtful, technical critique focused on code and architectural improvements.
- **Zero Tolerance**: Harassment, derogatory comments, or unprofessional behavior will not be tolerated.

---

## 🛠️ Development Workflow

### 1. Fork & Clone
Fork the repository on GitHub and clone your fork locally:
```bash
git clone https://github.com/<YOUR_USERNAME>/API_Hashira.git
cd API_Hashira
```

### 2. Branching Strategy
Always create a descriptive feature branch from `main`:
```bash
git checkout -b feature/enhanced-guardrail-classifier
# or
git checkout -b fix/telegram-inline-keyboard-wrap
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Local Environment
Copy `.env.example` to `.env` and set your Google Gemini API Key:
```bash
cp .env.example .env
```

Start the Vite + Express development server:
```bash
npm run dev
```

The application will bind to `http://localhost:3000`.

---

## 🧪 Testing & Validation Standards

Before pushing your branch or opening a Pull Request, run the full validation suite:

```bash
# 1. Ensure TypeScript compiles without any errors
npx tsc --noEmit

# 2. Test production build bundle
npm run build
```

---

## 📝 Commit Conventions

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:
- `feat:` A new feature (e.g., `feat: add multi-resume radar chart visualization`)
- `fix:` A bug fix (e.g., `fix: handle empty skill arrays in candidate cards`)
- `docs:` Documentation updates (e.g., `docs: update Telegram webhook setup guide`)
- `style:` Code style, formatting, or missing semicolons
- `refactor:` Code restructuring without functional modifications
- `test:` Adding or adjusting tests

---

## 📬 Submitting Pull Requests

1. Push your branch to your GitHub fork:
   ```bash
   git push origin feature/your-feature-name
   ```
2. Open a Pull Request against the `main` branch.
3. Include a clear description of the problem solved and test screenshots or terminal output.
4. Link any related issues using GitHub syntax (e.g., `Fixes #12`).
