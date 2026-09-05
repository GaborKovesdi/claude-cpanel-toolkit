---
name: ssh-key-setup
description: Create and install the one shared SSH key this toolkit uses for every cPanel project, register it in the toolkit defaults so all projects inherit it, and verify it works. Use once per machine or hosting account, and when onboarding a new machine.
---

# The shared SSH key

This toolkit deliberately uses **one key for the whole hosting account**, declared once and inherited by every project. A key per project sounds tidier and is worse in practice: more keys to authorise in cPanel, more to rotate when someone leaves, and more ways for a project to be silently unable to deploy.

Per-project keys are still possible — a project's `cpanel.site.json` can set its own `ssh.identityFile` — but that should be a deliberate exception with a reason.

## 1. Create the key

One key, one canonical path, no passphrase-less shortcuts on a shared machine:

```bash
ssh-keygen -t ed25519 -a 100 -f ~/.ssh/id_ed25519_cpanel -C "claude-toolkit@$(hostname)"
```

Use ed25519 — some older cPanel hosts still default to RSA, and if the host rejects ed25519, fall back to `-t rsa -b 4096`, but try ed25519 first.

**Use a passphrase**, and add the key to the agent so you type it once per session:

```bash
eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519_cpanel
```

On Windows the OpenSSH agent service does this persistently: `Start-Service ssh-agent; ssh-add ~/.ssh/id_ed25519_cpanel`.

## 2. Authorise it on the account

This is the one bootstrap step that cannot be automated from here — you need existing access to grant new access.

In cPanel: **Security → SSH Access → Manage SSH Keys → Import Key**. Paste the *public* key (`~/.ssh/id_ed25519_cpanel.pub`), leave the private key box empty, then click **Manage** next to the imported key and **Authorize** it. A key that is imported but not authorised looks correct and does not work — that is the most common failure here.

Some hosts disable SSH entirely until you ask support to enable it, and some use a non-standard port. Find out both before debugging anything else.

## 3. Register it once in the toolkit

In `config/sites.json`, under `defaults`:

```json
{
  "defaults": {
    "ssh": {
      "host": "server42.webhosting.example",
      "port": 22,
      "user": "demousr",
      "identityFile": "~/.ssh/id_ed25519_cpanel"
    }
  }
}
```

Every site inherits these field by field. A site only repeats what genuinely differs — a second hosting account, or a project that needs its own key. Projects scaffolded with `bin/new-project.mjs` inherit it automatically and their `cpanel.site.json` contains no SSH block at all.

Note that the cPanel SSH host is often `serverNN.<hosting-provider>` rather than the site's own domain. Using the site domain works until DNS moves to a CDN, then breaks confusingly.

## 4. Verify

```bash
ssh -i ~/.ssh/id_ed25519_cpanel -p 22 demousr@server42.webhosting.example "echo ok && pwd"
```

Then through the toolkit, which is the check that actually matters:

```
cpanel_ssh_exec site=<any site> command="echo ok && id -un && pwd"
cpanel_preflight site=<any site> environment=staging
```

If the raw `ssh` works but the toolkit does not, the config is wrong, not the key. Compare `cpanel_describe_site` output against the command you just ran by hand.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Permission denied (publickey)` | key imported but not **authorised** in cPanel, or wrong username |
| Hangs, then times out | wrong port, or the host firewalls SSH until you request access |
| Works by hand, fails from the toolkit | `identityFile` path wrong, or the agent holds a passphrase the non-interactive session cannot get — the toolkit runs ssh with `BatchMode=yes` and will never prompt |
| `Host key verification failed` | first connection; the toolkit uses `accept-new`, so connect once by hand and confirm the fingerprint |

## Rotation

The key is one file referenced in one place, so rotation is: generate the new key, import and authorise it, change `defaults.ssh.identityFile`, verify with a preflight, then remove the old key from cPanel. Do it in that order — deleting first locks you out of the account you need in order to fix it.
