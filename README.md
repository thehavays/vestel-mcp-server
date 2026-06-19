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

The server is configured via environment variables or a configuration file.

| Variable | Description | Example |
| :--- | :--- | :--- |
| `JIRA_URL` | Base URL of your Jira instance | `https://rdpm.vestel.com.tr/` |
| `JIRA_USERNAME` | Username (required for `basic` authentication) | `your_username` |
| `JIRA_PASSWORD` | Personal Access Token (PAT) or password | `your_pat_or_password` |
| `JIRA_AUTH_TYPE` | Authentication mechanism: `bearer` or `basic` (default) | `bearer` |
| `JIRA_REJECT_UNAUTHORIZED` | Toggle SSL certificate verification | `true` |
| `ALLOWED_PROJECTS` | Comma-separated list of allowed project keys. If empty, not set, or containing `*`, all projects are allowed. | `PROJ,TEST` |
| `ALLOWED_TOOLS` | Comma-separated list of allowed MCP tools. If empty, not set, or containing `*`, all tools are allowed. | `jira_get_issue,jira_search_issues` |

### Security Configuration File (`.jira-config.json`)

You can also restrict access by creating a `.jira-config.json` file in your server's working directory. 

* Use `*` inside the array to allow all projects or all tools (which is the default configuration).

```json
{
  "allowedProjects": ["*"],
  "allowedTools": ["*"]
}
```

If the file is present, it will take precedence over the environment variables.



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
        "JIRA_REJECT_UNAUTHORIZED": "true",
        "ALLOWED_PROJECTS": "*",
        "ALLOWED_TOOLS": "*"
      }
    }
  }
}
```

---

## Tools Documentation

### `jira_get_issue`
Retrieve details of a specific Jira issue (summary, status, assignee, reporter, description, comments, issueType, priority, and linkedIssues).
* **Input Schema**:
  - `issueKey` (string, required): Key (e.g., `PROJ-123`).
* **Output Schema**: Conforms to an object containing issue properties, comments, issueType, priority, and linkedIssues.

### `jira_get_issues_by_assignee`
Retrieve open/active issues (ignores resolved/closed statuses).
* **Input Schema**:
  - `username` (string, required): Jira username.
  - `maxResults` (number, optional): Defaults to `50`.
* **Output Schema**: `{ issues: Array<{ key, summary, status, updated, issueType, priority, linkedIssues: Array<{ direction, linkType, key, summary, status, issueType, priority }> }> }`

### `jira_get_review_issues_by_assignee`
Retrieve issues currently in a review status.
* **Input Schema**:
  - `username` (string, required): Jira username.
  - `maxResults` (number, optional): Defaults to `50`.
* **Output Schema**: `{ issues: Array<{ key, summary, status, updated, issueType, priority, linkedIssues: Array<{ direction, linkType, key, summary, status, issueType, priority }> }> }`

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
* **Output Schema**: `{ issues: Array<{ key, summary, status, assignee, updated, issueType, priority, linkedIssues: Array<{ direction, linkType, key, summary, status, issueType, priority }> }> }`

### `jira_get_watched_issues`
Retrieve a list of open/active issues watched by a specific user or the authenticated user.
* **Input Schema**:
  - `username` (string, optional): The Jira username of the watcher.
  - `maxResults` (number, optional): Defaults to `50`.
* **Output Schema**: `{ issues: Array<{ key, summary, status, updated, issueType, priority, linkedIssues: Array<{ direction, linkType, key, summary, status, issueType, priority }> }> }`

### `jira_get_user_activities`
Fetch a timeline feed of recent activities (comments, transitions, updates) performed by a user using the Jira Activity Stream.
* **Input Schema**:
  - `username` (string, optional): The Jira username to fetch activities for.
  - `startDate` (string, optional): Start date in `YYYY-MM-DD` format.
  - `endDate` (string, optional): End date in `YYYY-MM-DD` format.
  - `maxResults` (number, optional): Defaults to `50`.
* **Output Schema**: `{ activities: Array<{ title, published, content, url }> }`

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
