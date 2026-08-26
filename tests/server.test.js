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
      expect(toolNames).toContain('jira_get_issue_commits');
      expect(toolNames).toContain('jira_get_version_commits');
      expect(toolNames).toContain('jira_download_attachments');
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

    it('should handle jira_get_issue_commits and return commits', async () => {
      const getSpy = vi.spyOn(jiraClient, 'get').mockImplementation((url) => {
        if (url.includes('/rest/api/2/issue/')) {
          return Promise.resolve({ data: { id: '10001' } });
        }
        if (url.includes('/rest/dev-status/latest/issue/summary')) {
          return Promise.resolve({
            data: {
              summary: {
                repository: {
                  byInstanceType: {
                    'stash': { count: 1 },
                  },
                },
              },
            },
          });
        }
        if (url.includes('/rest/dev-status/latest/issue/detail')) {
          return Promise.resolve({
            data: {
              detail: [
                {
                  repositories: [
                    {
                      name: 'my-repo',
                      url: 'https://bitbucket.example.com/my-repo',
                      commits: [
                        {
                          id: 'abc1234',
                          message: 'Fix login bug',
                          author: { name: 'Jane Doe', email: 'jane@example.com' },
                          authorTimestamp: '2026-06-01T10:00:00.000+0000',
                          url: 'https://bitbucket.example.com/commits/abc1234',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          });
        }
        return Promise.reject(new Error('Unexpected URL: ' + url));
      });

      const result = await client.callTool({
        name: 'jira_get_issue_commits',
        arguments: { issueKey: 'PROJ-123' },
      });

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.issueKey).toBe('PROJ-123');
      expect(data.commits).toHaveLength(1);
      expect(data.commits[0].id).toBe('abc1234');
      expect(data.commits[0].message).toBe('Fix login bug');
      expect(data.commits[0].author).toBe('Jane Doe');
      expect(data.commits[0].repository).toBe('my-repo');
    });

    it('should handle jira_get_version_commits and aggregate commits from all issues', async () => {
      const getSpy = vi.spyOn(jiraClient, 'get').mockImplementation((url, config) => {
        // JQL search for issues in the version
        if (url === '/rest/api/2/search') {
          return Promise.resolve({
            data: {
              issues: [
                { id: '10001', key: 'PROJ-100', fields: { summary: 'Issue A' } },
                { id: '10002', key: 'PROJ-101', fields: { summary: 'Issue B' } },
              ],
            },
          });
        }
        // Dev-status summary — both issues have fecru repos
        if (url.includes('/rest/dev-status/latest/issue/summary')) {
          return Promise.resolve({
            data: {
              summary: {
                repository: { byInstanceType: { fecru: { count: 1 } } },
              },
            },
          });
        }
        // Dev-status detail — each issue returns one unique commit
        if (url.includes('/rest/dev-status/latest/issue/detail')) {
          const issueId = new URL('http://x' + url).searchParams.get('issueId');
          return Promise.resolve({
            data: {
              detail: [{
                repositories: [{
                  name: 'my-repo',
                  url: 'https://scm.example.com/my-repo',
                  commits: [{
                    id: `commit-${issueId}`,
                    message: `Fix for issue ${issueId}`,
                    author: { name: 'Dev User', email: 'dev@example.com' },
                    authorTimestamp: '2026-06-01T10:00:00.000+0000',
                    url: `https://scm.example.com/commits/commit-${issueId}`,
                  }],
                }],
              }],
            },
          });
        }
        return Promise.reject(new Error('Unexpected URL: ' + url));
      });

      const result = await client.callTool({
        name: 'jira_get_version_commits',
        arguments: { projectKey: 'PROJ', version: 'v1.0.0' },
      });

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.projectKey).toBe('PROJ');
      expect(data.version).toBe('v1.0.0');
      expect(data.issueCount).toBe(2);
      expect(data.commits).toHaveLength(2);
      // Each commit should carry its originating issueKey
      const issueKeys = data.commits.map(c => c.issueKey);
      expect(issueKeys).toContain('PROJ-100');
      expect(issueKeys).toContain('PROJ-101');
    });
    it('should handle jira_download_attachments and download files', async () => {
      const getSpy = vi.spyOn(jiraClient, 'get').mockImplementation((url) => {
        if (url.includes('/rest/api/2/issue/')) {
          return Promise.resolve({
            data: {
              key: 'PROJ-123',
              fields: {
                attachment: [
                  { filename: 'test.txt', content: 'https://example.com/test.txt' }
                ]
              }
            }
          });
        }
        if (url === 'https://example.com/test.txt') {
          const fakeStream = {
            pipe: vi.fn(),
          };
          return Promise.resolve({ data: fakeStream });
        }
        return Promise.reject(new Error('Unexpected URL: ' + url));
      });

      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
      const writeStreamMock = {
        on: vi.fn((event, callback) => {
          if (event === 'finish') {
            callback(); // Simulate immediate finish
          }
        }),
      };
      const createWriteStreamSpy = vi.spyOn(fs, 'createWriteStream').mockReturnValue(writeStreamMock);

      const result = await client.callTool({
        name: 'jira_download_attachments',
        arguments: { issueKey: 'PROJ-123', downloadPath: '/fake/path' }
      });

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text);
      expect(data.issueKey).toBe('PROJ-123');
      expect(data.downloadedFiles).toHaveLength(1);
      expect(data.downloadedFiles[0]).toContain('test.txt');

      expect(getSpy).toHaveBeenCalledWith('/rest/api/2/issue/PROJ-123');
      expect(getSpy).toHaveBeenCalledWith('https://example.com/test.txt', { responseType: 'stream' });
      expect(createWriteStreamSpy).toHaveBeenCalled();
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
