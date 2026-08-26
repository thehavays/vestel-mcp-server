# Project Guidelines & Developer Onboarding for Vestel Jira MCP

This document is a comprehensive guide for AI agents and developers to understand, find, and develop the `vestel-jira-mcp` Node.js application.

---

## 📖 Project Summary

**Vestel Jira MCP** is a Model Context Protocol (MCP) server for integrating with Jira. It provides tools and resources to interact with Jira issues, users, and projects through the MCP protocol.

### Key Technologies
- **Framework**: Node.js (ES Modules)
- **Core SDK**: `@modelcontextprotocol/sdk`
- **HTTP Client**: `axios`
- **Testing**: `vitest`

---

## 📂 Implementation Paths & Project Structure

The project code is a standard Node.js package structure:

* **[vestel-jira-mcp/](../)**: Root folder of the repository.
  * **[index.js](../index.js)**: Contains the main logic and entry point for the MCP server.
  * **[tests/](../tests)**: Contains vitest unit tests.
  * **[scripts/](../scripts)**: Contains helper scripts for development (e.g., mock fetching).
  * **[package.json](../package.json)**: Defines Node.js dependencies, scripts, and project metadata.
  * **[.github/](../.github)**: GitHub Actions workflows and configuration.
  * **[.agents/](../.agents)**: Agent configuration and guidelines.

---

## 🛠️ Development & Operational Workflows

### 1. Running the Project

To run the MCP server locally, ensure you have installed dependencies, then run:

```bash
npm install
npm start
```

### 2. Testing the Project

To run unit tests using Vitest:

```bash
npm run test
```

### 3. Git & GitHub Flow

Refer to the detailed [Git & GitHub Workflow Guidelines](./GIT_WORKFLOW.md) for branch strategy, commit rules, PR workflows, and the GITHUB_TOKEN environment override command.

### 4. GitHub Actions & CI/CD

Refer to the detailed [GitHub Actions Guidelines](./GITHUB_ACTIONS.md) for CI validation (formatting, linting, tests) for PRs.
