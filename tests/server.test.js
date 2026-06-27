import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { server, jiraClient, isProjectAllowed, enforceJqlSecurity } from '../index.js';
import fs from 'fs';
import path from 'path';

// Load mock files
const issueMock = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/mocks/jira_get_issue_mock.json'), 'utf8'));
const searchMock = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/mocks/jira_search_mock.json'), 'utf8'));

describe('Jira MCP Server Tests', () => {
  let client;
  let clientTransport;
  let serverTransport;

  beforeEach(async () => {
    const [cTrans, sTrans] = InMemoryTransport.createLinkedPair();
    clientTransport = cTrans;
    serverTransport = sTrans;

    client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await client.close();
    await server.close();
  });

  describe('Protocol & Tools Discovery', () => {
    it('should list all tools when calling listTools', async () => {
      const response = await client.listTools();
      expect(response.tools).toBeDefined();
      expect(response.tools.length).toBeGreaterThan(0);

      const toolNames = response.tools.map(t => t.name);
      expect(toolNames).toContain('jira_get_issue');
      expect(toolNames).toContain('jira_get_issues_by_assignee');
      expect(toolNames).toContain('jira_search_issues');
      expect(toolNames).toContain('jira_create_issue');
      expect(toolNames).toContain('jira_update_issue');
      expect(toolNames).toContain('jira_add_comment');
      expect(toolNames).toContain('jira_get_watched_issues');
      expect(toolNames).toContain('jira_get_user_activities');
    });
  });

  describe('Tool Execution (callTool)', () => {
    it('should handle jira_get_issue and return correct formatted output', async () => {
      const getSpy = vi.spyOn(jiraClient, 'get').mockResolvedValue({
        data: issueMock
      });

      const result = await client.callTool({
        name: 'jira_get_issue',
        arguments: { issueKey: 'PROJ-123' }
      });

      expect(getSpy).toHaveBeenCalledWith('/rest/api/2/issue/PROJ-123');
      expect(result.isError).toBeUndefined();
      
      const data = JSON.parse(result.content[0].text);
      expect(data.key).toBe('PROJ-123');
      expect(data.summary).toBe('Example Issue Summary');
      expect(data.status).toBe('In Progress');
      expect(data.assignee).toBe('john.doe');
      expect(data.comments.length).toBe(1);
      expect(data.comments[0].body).toBe('This is a comment on the issue.');
    });

    it('should handle jira_search_issues and return issues', async () => {
      const getSpy = vi.spyOn(jiraClient, 'get').mockResolvedValue({
        data: searchMock
      });

      const result = await client.callTool({
        name: 'jira_search_issues',
        arguments: { jql: 'project = PROJ' }
      });

      expect(getSpy).toHaveBeenCalledWith('/rest/api/2/search', {
        params: { jql: 'project = PROJ', maxResults: 50 }
      });
      
      const data = JSON.parse(result.content[0].text);
      expect(data).toBeInstanceOf(Array);
      expect(data[0].key).toBe('PROJ-123');
      expect(data[0].summary).toBe('Example Issue Summary');
    });

    it('should return error when Jira client throws an exception', async () => {
      vi.spyOn(jiraClient, 'get').mockRejectedValue({
        message: 'Network Error',
        response: { data: 'Connection Refused' }
      });

      const result = await client.callTool({
        name: 'jira_get_issue',
        arguments: { issueKey: 'PROJ-123' }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error executing tool jira_get_issue');
    });
  });

  describe('Security Logic Unit Tests', () => {
    it('should validate allowed project checks', () => {
      // isProjectAllowed should return true if config allows '*' or specific project
      expect(isProjectAllowed('PROJ')).toBe(true);
    });

    it('should properly enforce JQL security constraints', () => {
      // By default allowedProjects contains '*' so enforceJqlSecurity shouldn't restrict
      const originalJql = 'status = "In Progress"';
      const securedJql = enforceJqlSecurity(originalJql);
      expect(securedJql).toBe(originalJql);
    });
  });
});
