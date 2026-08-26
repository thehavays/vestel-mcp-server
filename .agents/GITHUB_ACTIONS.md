# GitHub Actions & CI/CD Guidelines for Vestel Jira MCP

---

## ⚙️ Environment Variables (Context)
* **GITHUB_USERNAME**: `thehavays`
* **GITHUB_PROJECT_NAME**: `vestel-jira-mcp`

---

This document details the GitHub Actions CI/CD workflows and rules for creating or modifying workflow files.

---

## 🚀 Active Workflows Summary

Currently configured workflows are stored under [`.github/workflows/`](../.github/workflows):

### 1. Run Tests (`test.yml`)
* **File**: [`.github/workflows/test.yml`](../.github/workflows/test.yml)
* **Trigger**: Triggers on `push` and `pull_request` targeting `main`.
* **Actions Performed**:
  1. Checks out the repository code.
  2. Sets up the Node.js environment (versions 20.x, 22.x).
  3. Installs dependencies (`npm ci`).
  4. Runs tests (`npm run test`).

---

## 🛠️ Guidelines for Adding & Modifying Workflows

### 1. Workflow File Location
All GitHub Actions workflow definition files **must** be placed in:
```text
.github/workflows/<workflow-name>.yml
```

### 2. Branch Triggering Rules
* **Pull Request Validation (CI)**:
  * Tests trigger on `push` and `pull_request` targeting `main`.
  * **Best Practices for PR CI Trigger**:
    * Use `paths-ignore` to skip running workflows when only documentation or agent rules change.
    * Use `concurrency` with `cancel-in-progress: true` to auto-cancel outdated workflow runs.

### 3. Strict Separation of CI and CD
For now, only Testing (CI) is implemented. Any CD pipeline (like publishing to npm) should be done via separate workflows.
