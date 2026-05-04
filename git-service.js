// git-service.js
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

class GitService {
    constructor(repoPath) {
        this.repoPath = repoPath || __dirname;
        this.gitAvailable = false;
        this.initialized = false;
    }

    async initialize() {
        try {
            await this.checkGitAvailability();
            this.initialized = true;
        } catch (err) {
            console.log('Git init error:', err.message);
            this.initialized = true;
        }
    }

    async checkGitAvailability() {
        const gitDir = path.join(this.repoPath, '.git');
        if (!fs.existsSync(gitDir)) {
            console.log('No .git directory found - running in local mode');
            this.gitAvailable = false;
            return;
        }

        return new Promise((resolve) => {
            exec('git --version', { cwd: this.repoPath, timeout: 5000 }, (err, stdout) => {
                this.gitAvailable = !err;
                if (err) {
                    console.log('Git command not available - running in local mode');
                } else {
                    console.log('Git available:', stdout.trim());
                }
                resolve();
            });
        });
    }

    isAvailable() {
        return this.gitAvailable;
    }

    async syncStatus() {
        if (!this.gitAvailable) {
            return {
                syncAvailable: false,
                localOnly: true,
                message: 'Running in local mode'
            };
        }

        return new Promise((resolve) => {
            exec('git fetch --dry-run 2>&1', {
                cwd: this.repoPath,
                timeout: 10000
            }, (fetchErr) => {
                if (fetchErr) {
                    return resolve({
                        syncAvailable: false,
                        localOnly: true,
                        message: 'Cannot reach remote repository'
                    });
                }

                exec('git rev-list HEAD...origin/main --count 2>&1', {
                    cwd: this.repoPath,
                    timeout: 5000
                }, (revErr, revStdout) => {
                    const behindCount = revErr ? 0 : parseInt(revStdout.trim()) || 0;
                    resolve({
                        syncAvailable: true,
                        localOnly: false,
                        updatesAvailable: behindCount > 0,
                        behindCount: behindCount,
                        message: behindCount > 0
                            ? `${behindCount} update(s) available`
                            : 'Up to date'
                    });
                });
            });
        });
    }

    async sync() {
        if (!this.gitAvailable) {
            return {
                success: false,
                localOnly: true,
                message: 'Git not available - running in local mode'
            };
        }

        return new Promise((resolve, reject) => {
            // Step 1: Stash local changes
            exec('git stash', {
                cwd: this.repoPath,
                timeout: 10000
            }, (stashErr) => {
                // Step 2: Pull latest from remote
                exec('git pull --rebase origin main', {
                    cwd: this.repoPath,
                    maxBuffer: 1024 * 1024 * 10,
                    timeout: 30000
                }, (pullErr, pullStdout, pullStderr) => {
                    if (pullErr) {
                        exec('git stash pop', { cwd: this.repoPath }, () => { });
                        reject(new Error(`Pull failed: ${pullStderr || pullErr.message}`));
                        return;
                    }

                    // Step 3: Restore stashed changes
                    exec('git stash pop', {
                        cwd: this.repoPath,
                        timeout: 10000
                    }, (popErr) => {
                        // Step 4: Stage lenses.json
                        exec('git add lenses.json', { cwd: this.repoPath }, (addErr) => {
                            if (addErr) {
                                reject(new Error(`Failed to stage: ${addErr.message}`));
                                return;
                            }

                            // Step 5: Commit
                            const commitMsg = `Update lenses - ${new Date().toISOString()}`;
                            exec(`git commit -m "${commitMsg}"`, {
                                cwd: this.repoPath,
                                timeout: 10000
                            }, (commitErr, commitStdout, commitStderr) => {
                                // "nothing to commit" is not a real error — continue to push
                                const nothingToCommit = commitStderr && commitStderr.includes('nothing to commit');

                                // Step 6: Push to remote
                                exec('git push origin main', {
                                    cwd: this.repoPath,
                                    maxBuffer: 1024 * 1024 * 10,
                                    timeout: 30000
                                }, (pushErr, pushStdout, pushStderr) => {
                                    if (pushErr) {
                                        reject(new Error(`Push failed: ${pushStderr || pushErr.message}`));
                                        return;
                                    }
                                    resolve({
                                        success: true,
                                        output: pushStdout,
                                        message: nothingToCommit ? 'Already up to date' : 'Changes synced successfully'
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    }

    async getLastCommitInfo() {
        if (!this.gitAvailable) {
            return { available: false };
        }

        return new Promise((resolve) => {
            exec('git log -1 --format="%H|%s|%ai"', {
                cwd: this.repoPath,
                timeout: 5000
            }, (err, stdout) => {
                if (err) return resolve({ available: false });

                const [hash, message, date] = stdout.trim().split('|');
                resolve({
                    available: true,
                    hash: hash?.substring(0, 7),
                    message,
                    date
                });
            });
        });
    }
}

module.exports = GitService;