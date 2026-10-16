# Putting TACSI DV online with your own Claude API key

This guide puts the TACSI DV prototype (the domestic abuse version of TACSI) on the internet at its own web address, for example `https://tacsi-dv-prototype.onrender.com`, so that invited stakeholders (councils, charities, partners) can try it on their own computers. It is not for members of the public: only people who have the access code can use it.

If you already run the original TACSI on Render, you can use the same Render account and the same API key: you create a second web service. You can use a different access code and staff PIN.

TACSI runs on a hosting service called **Render**, which keeps it running around the clock. You click through Render's website; there is no programming.

You will need about 30 minutes, an email address and a bank card.

Words used in this guide:

- **API key**: a long password that lets TACSI use Claude. Every conversation is paid for through it.
- **Hosting service**: a company that runs a website for you on its computers.
- **GitHub**: the website where TACSI's files are stored. You already have an account (dodi1978).
- **Environment variable**: a private setting you type into Render, such as your API key. It is never shown on the website.

---

## Part 1: Your Claude API key

You need an API key and some credit. If you already have both, go to Part 2.

1. Go to **https://console.anthropic.com** and sign in, or create an account.
2. Add credit. Click **Billing** (sometimes under **Settings**) and add a small amount, for example £10.
3. **Set a spending limit** so you can never be charged more than you planned. Find **Limits** (usually under **Settings**) and set a monthly limit, for example £20.
4. Create a key. Click **API Keys**, then **Create Key**. Name it `TACSI online`.
5. **Copy the key** (a long code starting with `sk-ant-`) and keep it somewhere private, such as a password manager. You can only see it once. If you lose it, create a new one.

Never email the key, put it in a document or share it. Anyone who has it can spend your credit.

---

## Part 2: Choose two private codes

Write these down somewhere private. You will type them into Render in Part 3.

1. **Access code**: the code you give to the stakeholders you invite. Without it, nobody can use TACSI or spend your credit. Use something not easy to guess, for example `tacsi-blue-7341`.
2. **Staff PIN**: the PIN for the staff view, where stakeholders can see the report a support worker would get. Use at least 6 digits, for example `582914`. Do not use `1234`.

---

## Part 3: Put TACSI on Render

1. Go to **https://render.com** and click **Get Started** (or **Sign up**).
2. Choose **GitHub** to sign up. Sign in to GitHub as **dodi1978** if asked, then click **Authorize**. This lets Render read TACSI's files.
3. Render may ask a few questions about you. Answer them and continue until you see the **Dashboard**.
4. Click **+ New** (top right), then **Web Service**.
5. Under **Git Provider**, choose **GitHub**. If you cannot see `dodi1978/dodi1978` in the list:
   - click **Configure GitHub** (or **Connect GitHub**),
   - choose your account **dodi1978**,
   - choose **Only select repositories**, pick **dodi1978/dodi1978**, and click **Save** (or **Install**).
6. Click **dodi1978/dodi1978** in the list, then **Connect**.
7. Fill in the form exactly like this. Leave anything not listed as it is.

   | Field | What to enter |
   |---|---|
   | **Name** | `tacsi-dv-prototype` (this becomes part of the web address) |
   | **Language** (or **Runtime**) | `Node` |
   | **Branch** | `main` |
   | **Region** | `Frankfurt (EU Central)` (the closest to the UK) |
   | **Root Directory** | `tacsi-dv` |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Instance Type** | `Free` to try it out (see Part 6) |

8. Find **Environment Variables** further down the same page. Click **Add Environment Variable** three times and fill in:

   | NAME (type exactly, in capitals) | VALUE |
   |---|---|
   | `ANTHROPIC_API_KEY` | your API key from Part 1 |
   | `TACSI_ACCESS_CODE` | your access code from Part 2 |
   | `TACSI_STAFF_PIN` | your staff PIN from Part 2 |

9. Click **Deploy Web Service** at the bottom.
10. Wait about 2 to 5 minutes. You will see lines of text scrolling. That is normal.
11. It is ready when you see **Live** (green) near the top, and a line saying `TACSI running on ... (engine: Claude AI)`.
    - If it says `engine: offline demo`, the API key is missing: see "If something goes wrong" below.
12. Your web address is shown near the top left, under the name, for example `https://tacsi-dv-prototype.onrender.com`. Click it.

---

## Part 4: Test it yourself

1. Open your web address in **Chrome** or **Edge**.
2. You see **Try the TACSI prototype**. Type your access code and click **Save**.
3. Choose a language and have a short conversation.
4. To try the microphone: tap it and click **Allow** when the browser asks.
5. At the end, send the case to a support worker.
6. Open the staff view: add `/staff` to the end of your address, for example `https://tacsi-dv-prototype.onrender.com/staff`, and enter your staff PIN.

---

## Part 5: Invite stakeholders

Send each stakeholder an email like this. Replace the parts in [square brackets].

> **Subject:** Try the TACSI prototype
>
> Dear [name],
>
> Thank you for agreeing to try TACSI, a prototype triage tool that helps people explain a problem in their own language and finds them the right support.
>
> 1. Open this link in Chrome or Edge on a computer or tablet: [your web address]
> 2. Enter the access code: [access code]
> 3. Pretend to be someone looking for help. Many people affected by domestic abuse do not mention it at first, so try starting with something else, for example money worries, a visa, the children, or needing somewhere to live, and see how TACSI responds. You can type in any language, or use the microphone.
> 4. At the end, choose to send your conversation to a support worker. Then open [your web address]/staff and enter the PIN [staff PIN] to see the report a support worker would get.
>
> Please use made-up situations only, not real personal information. The first time you open the link it may take up to a minute to start.
>
> I would be grateful for your thoughts on: [your questions, for example: Was it easy to use? Would the report help your staff? What is missing?]
>
> Best wishes,
> [your name]

Tips:

- Everyone you invite sees every case sent in the staff view, so ask them to use made-up situations only.
- If you want to stop someone using TACSI, change the access code (see "Changing a setting later") and send the new code to everyone else.
- You can see how much the testing costs in the Anthropic console under **Usage**.

## Part 6: Things to know

- **Free plan**: if nobody uses TACSI for 15 minutes, Render puts it to sleep. The next person then waits about a minute for it to wake up. This is usually fine for testing. If it gets in the way, for example during a workshop, choose the **Starter** plan (about $7 a month): open your service in Render, click **Settings**, then **Instance Type**. Tip: open the link yourself a few minutes before a workshop to wake it up.
- **Cases are deleted** when TACSI restarts or goes to sleep. This prototype does not store data permanently, on purpose. Ask stakeholders to look at the staff view straight after their conversation.
- **Cost**: each conversation uses your API credit, roughly 20 to 50 pence. You can see your spending in the Anthropic console under **Usage**.
- **No real personal information**: this is a prototype for stakeholders to try with made-up situations. It is not ready for members of the public.
- **Data**: what people type is processed by Render (in Frankfurt) and by Anthropic.
- **Updates**: when changes to TACSI are merged into the `main` branch on GitHub, Render updates the website by itself within a few minutes. Each update restarts TACSI, so cases in the staff view are deleted. When you ask Claude Code for changes in a new session, say: "When you are done, merge the changes into main."

---

## Changing a setting later

1. Go to **https://dashboard.render.com** and click **tacsi-dv-prototype**.
2. Click **Environment** on the left.
3. Click **Edit**, change the value, and click **Save Changes**. TACSI restarts by itself.

To change the access code, change `TACSI_ACCESS_CODE`. Everyone will then be asked for the new code.

To stop TACSI completely: open the service, click **Settings**, scroll to the bottom and click **Suspend Web Service** (or **Delete Web Service**).

---

## If something goes wrong

| What you see | What to do |
|---|---|
| Render says **Build failed** | Check that **Root Directory** is `tacsi-dv` and **Branch** is `main` (Settings page). Then click **Manual Deploy**, then **Deploy latest commit**. |
| TACSI says **Demo mode** | The API key is missing or wrong. Check `ANTHROPIC_API_KEY` under **Environment**: no spaces before or after it. Make sure your Anthropic account has credit. |
| **That code is not right** | The access code is typed exactly as in `TACSI_ACCESS_CODE`, including capitals. |
| The page takes a minute to open | The free plan was asleep. Wait, or move to the Starter plan. |
| **Too many messages** | One network (for example one office) has sent more than 120 messages in an hour. Wait for the next hour. To change the limit, add an environment variable `TACSI_HOURLY_LIMIT` with a higher number. |
| Anything else | In Render, click **Logs** on the left. Copy the last red lines and send them to whoever helps you with TACSI. |
