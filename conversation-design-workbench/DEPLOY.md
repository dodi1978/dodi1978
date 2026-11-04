# Putting the Conversation Design Workbench online with Netlify

This guide puts the workbench on the internet at its own web address, for example `https://cd-workbench.netlify.app`. Only people who know the passphrase can open it.

You click through websites; there is no programming. Allow about 45 minutes.

Words used in this guide:

- **API key**: a long password that lets the workbench use a service (Claude or Voyage AI). Use is paid for through it.
- **Environment variable**: a private setting you type into Netlify, such as an API key. It is never shown on the website or stored in GitHub.
- **Database**: where the workbench saves your projects, documents and conversations between sessions.

You will set up five things:

| Part | What | Cost |
|---|---|---|
| 1 | Claude API key | Pay as you go (set a monthly limit) |
| 2 | Voyage AI API key (meaning-based search) | First 200 million tokens free |
| 3 | A passphrase | Free |
| 4 | The Netlify site | Your existing Netlify plan |
| 5 | The database | Free tier to start |

> **Note:** Netlify's screens change from time to time. If a button in this guide has a slightly different name, look for the closest match. If you get stuck, tell Claude what you see on the screen.

---

## Part 1: Claude API key and spending limit

If you already have a key from TACSI, you can create a second one for the workbench, so you can see the costs separately.

1. Go to **https://console.anthropic.com** and sign in.
2. Make sure you have credit: click **Billing** (sometimes under **Settings**).
3. **Set a monthly spending limit.** Find **Limits** (usually under **Settings**) and set a monthly limit you are comfortable with, for example £20. The workbench can never spend more than this.
4. Click **API Keys**, then **Create Key**. Name it `Workbench`.
5. **Copy the key** (it starts with `sk-ant-`) into a password manager. You can only see it once.

---

## Part 2: Voyage AI API key (meaning-based search)

1. Go to **https://dashboard.voyageai.com** and sign up.
2. Click **Billing** and add a payment method. You are not charged within the free allowance (200 million tokens), but without a card your account is limited to very few requests per minute and indexing documents will be slow.
3. **Set a spending limit** if your account offers one (look under **Billing** or **Usage**). A low limit, for example $5, is plenty.
4. Click **API Keys**, then **Create new secret key**. Name it `Workbench`.
5. Copy the key into your password manager.

Without this key the workbench still works, but uses keyword search only.

---

## Part 3: Choose a passphrase

Choose a passphrase for opening the workbench and write it in your password manager. Make it hard to guess, for example four random words: `harbour-violet-copper-ninety`.

The passphrase protects your data and your API credit. Anyone who has it can use the workbench.

---

## Part 4: Create the Netlify site

The workbench's files must be on the **main** branch of your GitHub repository first. If Claude has opened a pull request for it, merge that pull request on GitHub before you start.

1. Go to **https://app.netlify.com** and sign in.
2. Click **Add new project** (or **Add new site**), then **Import an existing project**.
3. Choose **GitHub**. Sign in as **dodi1978** if asked. If `dodi1978/dodi1978` is not listed, click **Configure the Netlify app on GitHub**, allow access to **dodi1978/dodi1978**, and come back.
4. Click **dodi1978/dodi1978**.
5. Fill in the build settings exactly like this:

   | Field | What to enter |
   |---|---|
   | **Branch to deploy** | `main` |
   | **Base directory** | `conversation-design-workbench` |
   | **Build command** | leave empty (it comes from the project's settings file) |
   | **Publish directory** | leave empty (same) |
   | **Functions directory** | leave empty (same) |

6. Find **Environment variables** on the same page (sometimes under **Advanced**, or add them afterwards under **Site configuration → Environment variables**). Add three:

   | Key | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your Claude key from Part 1 |
   | `VOYAGE_API_KEY` | your Voyage AI key from Part 2 |
   | `WORKBENCH_PASSPHRASE` | your passphrase from Part 3 |

7. Click **Deploy**. The first deploy takes 2–3 minutes. It runs the workbench's tests first; if they fail, nothing goes online.
8. Give the site a nicer address: **Site configuration → Change site name**, for example `cd-workbench`. Your address becomes `https://cd-workbench.netlify.app`.

If you open the address now, you can log in, but you will see **"No database is connected"**. That is Part 5.

---

## Part 5: Connect a database

### Option A (try first): Netlify's built-in database

1. In your site on Netlify, look in the left-hand menu for **Database** (it may also be under **Extensions**, called **Netlify Database** or **Neon**).
2. Click **Create database** (or **Add database** / **Install**), and follow the steps.
3. If Netlify asks you to **claim** the database (connect it to a Neon account), do it: unclaimed databases can be deleted after a few days.
4. Netlify adds the database address to your site automatically, as an environment variable called `NETLIFY_DB_URL` or `NETLIFY_DATABASE_URL`. You do not need to copy it anywhere.
5. Go to **Deploys** and click **Trigger deploy → Deploy site**, so the workbench picks up the database.

### Option B: a free Neon database directly

Use this if you cannot find Option A.

1. Go to **https://neon.tech**, sign up, and create a project (choose region **Europe (Frankfurt)** or **Europe (London)** if offered).
2. On the project dashboard, click **Connect** and copy the **connection string** (it starts with `postgresql://` and contains a password, so treat it like an API key).
3. In Netlify: **Site configuration → Environment variables → Add a variable**: key `DATABASE_URL`, value the connection string.
4. **Deploys → Trigger deploy → Deploy site**.

Either way, the workbench creates its tables automatically the first time it runs. It uses the database's `vector` extension for fast meaning-based search when the database offers it (Neon does), and works without it otherwise.

---

## Part 6: Check it works

1. Open your site's address and enter the passphrase.
2. Create a project, add a short document, and wait for **Index for meaning-based search** to finish.
3. On **Test chat**, ask a question the document answers. Click **Passages given to the bot** under the reply to see what the bot was given.
4. On **Overview**, check that **API use and cost** shows a small amount.

---

## Good to know

- **Time limits.** Each request to the workbench must finish within about 30 seconds (a Netlify limit). Chat replies normally take a few seconds. If a reply times out, lower the bot's **Effort** or choose a faster model on the **Chatbot** page. Indexing documents happens in small batches with a progress bar, so it never hits the limit.
- **Upload size.** Files can be up to 4 MB each. Split larger PDFs.
- **Changing the passphrase.** Change `WORKBENCH_PASSPHRASE` in Netlify and redeploy. Everyone is logged out.
- **Costs.** The **Overview** page shows an estimate per project. Your Anthropic and Voyage AI dashboards show the actual bill.
- **Moving to Render later.** The same code runs on Render: create a **Web Service** with **Root Directory** `conversation-design-workbench`, **Build Command** `npm install`, **Start Command** `npm start`, and the same environment variables, plus `DATABASE_URL` pointing at your database. Your data stays in the database, so nothing needs copying if you keep the same one.

## Troubleshooting

| What you see | What to do |
|---|---|
| "No passphrase is set" | Add `WORKBENCH_PASSPHRASE` (Part 4, step 6) and redeploy. |
| "No database is connected" | Do Part 5, then redeploy. |
| "The server could not start" | The database address is wrong or the database is paused. Check Part 5. |
| "Claude rejected the API key" | Check `ANTHROPIC_API_KEY` for typos or spaces, and redeploy. |
| "Claude is busy or your spending limit was reached" | Wait a minute, or raise your monthly limit in the Anthropic console. |
| Yellow box: "Meaning-based search is not set up" | Add `VOYAGE_API_KEY` and redeploy. Then click **Index now** on the Documents page. |
| Indexing is very slow or stops with "Too many requests" | Add a payment method in Voyage AI (Part 2, step 2). |
| The deploy fails | Open the failed deploy in Netlify, copy the last 30 lines of the log, and send them to Claude. |
