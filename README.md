# Vestel Jira MCP Server

An integration server built on the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) that connects AI assistants to Jira. It provides tools to retrieve, search, create, and update issues, supporting input/output schema validation.

## Features

- **Get Assigned Issues**: Inclusive retrieval of active issues (`Pending`, `Submitted`, `In Progress`, `Open`, `Reopened`).
- **Fetch Issue Details**: Retrieve key fields, descriptions, and comments.
- **Query Issues via JQL**: Perform flexible Jira Query Language searches.
- **Manage Issues**: Create new issues, update fields, and add comments.
- **Strict Schema Compliance**: All tools declare input and output schemas conforming to the MCP specifications.

---

## Installation

1. Clone or copy the repository files.
2. Install dependencies:
   ```bash
   npm install
   ```

---

## Configuration

The server is configured via environment variables.

| Variable | Description | Example |
| :--- | :--- | :--- |
| `JIRA_URL` | Base URL of your Jira instance | `https://rdpm.vestel.com.tr/` |
| `JIRA_USERNAME` | Username (required for `basic` authentication) | `your_username` |
| `JIRA_PASSWORD` | Personal Access Token (PAT) or password | `your_pat_or_password` |
| `JIRA_AUTH_TYPE` | Authentication mechanism: `bearer` or `basic` (default) | `bearer` |
| `JIRA_REJECT_UNAUTHORIZED` | Toggle SSL certificate verification | `true` |

---

## MCP Integration Guide

Configure your MCP host (such as Claude Desktop or Gemini Code Assist) to launch the server.

### Example configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "vestel-jira": {
      "command": "npx",
      "args": ["-y", "github:thehavays/vestel-mcp-server"],
      "env": {
        "JIRA_URL": "https://rdpm.vestel.com.tr/",
        "JIRA_USERNAME": "your_username",
        "JIRA_PASSWORD": "your_secure_password_or_token",
        "JIRA_AUTH_TYPE": "bearer",
        "JIRA_REJECT_UNAUTHORIZED": "true"
      }
    }
  }
}
```

---

## Tools Documentation

### `jira_get_issue`
Retrieve details of a specific Jira issue (summary, status, assignee, reporter, description, comments).
* **Input Schema**:
  - `issueKey` (string, required): Key (e.g., `PROJ-123`).
* **Output Schema**: Conforms to an object containing issue properties and comments.

### `jira_get_issues_by_assignee`
Retrieve open/active issues (ignores resolved/closed statuses).
* **Input Schema**:
  - `username` (string, required): Jira username.
  - `maxResults` (number, optional): Defaults to `50`.
* **Output Schema**: `{ issues: Array<{ key, summary, status, updated }> }`

### `jira_get_review_issues_by_assignee`
Retrieve issues currently in a review status.
* **Input Schema**:
  - `username` (string, required): Jira username.
  - `maxResults` (number, optional): Defaults to `50`.
* **Output Schema**: `{ issues: Array<{ key, summary, status, updated }> }`

### `jira_create_issue`
Create a new issue.
* **Input Schema**:
  - `projectKey` (string, required)
  - `summary` (string, required)
  - `description` (string, required)
  - `issueType` (string, required)
* **Output Schema**: `{ key, url }`

### `jira_update_issue`
Update fields of an existing issue.
* **Input Schema**:
  - `issueKey` (string, required)
  - `fields` (object, required)
* **Output Schema**: `{ issueKey, success }`

### `jira_add_comment`
Add a comment to an issue.
* **Input Schema**:
  - `issueKey` (string, required)
  - `comment` (string, required)
* **Output Schema**: `{ issueKey, commentId, success }`

### `jira_search_issues`
Search using JQL.
* **Input Schema**:
  - `jql` (string, required)
  - `maxResults` (number, optional)
* **Output Schema**: `{ issues: Array<{ key, summary, status, assignee, updated }> }`

---

## Sharing and Distribution

> [!WARNING]
> **Important Security Practice**: Never share or commit the `.agents/mcp_config.json` or `.env` files that contain sensitive environment values (such as passwords, usernames, or access tokens).

To prepare this server for package registry/repository hosting:
1. Initialize git and configure `.gitignore` to prevent committing secrets:
   ```bash
   git init
   echo "node_modules/" >> .gitignore
   echo ".agents/" >> .gitignore
   echo ".env" >> .gitignore
   ```
2. Specify included files inside your `package.json`:
   ```json
   "files": [
     "index.js",
     "package.json",
     "README.md"
   ]
   ```
3. Generate a release bundle for local sharing:
   ```bash
   npm pack
   ```
