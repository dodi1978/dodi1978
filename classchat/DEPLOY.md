# Putting ClassChat online (Render)

This puts ClassChat at its own web address, for example `https://classchat-dippold.onrender.com`, so students can join from anywhere. It's the same service you used for TACSI. If your Render account is already connected to GitHub, this takes about 10 minutes.

ClassChat doesn't use the Claude API, so you don't need an API key and it costs nothing to run.

## 1. Choose a teacher code

Choose a private code, for example `seminar-otter-4821`. You type it when you start a session. Without it, nobody else can start sessions on your site. Students never need it.

## 2. Create the web service

1. Go to **https://dashboard.render.com** and sign in.
2. Click **+ New**, then **Web Service**, then choose **dodi1978/dodi1978**.
3. Fill in:

   | Field | What to enter |
   |---|---|
   | **Name** | `classchat-dippold` (this becomes part of the web address) |
   | **Language** | `Node` |
   | **Branch** | `main` |
   | **Region** | `Frankfurt (EU Central)` |
   | **Root Directory** | `classchat` |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Instance Type** | `Free` is fine to try. See the note below. |

4. Under **Environment Variables**, add:
   - **Key** `CLASSCHAT_TEACHER_CODE`, **Value** your teacher code
5. Under **Advanced**, set **Health Check Path** to `/healthz`.
6. Click **Deploy Web Service**. Wait until it says **Live**, then open the address shown at the top and add `/teacher`.

## Free vs paid

On the **Free** plan, Render puts the site to sleep after 15 minutes with no visitors, and it takes about a minute to wake up. Waking up also clears any open session.

- **Free plan:** open your teacher page **a few minutes before class** and start your session then. Students keep it awake while class is running.
- **Starter plan** (about $7 a month): it never sleeps. Choose this if you use it every week.

## Updating

Whenever new changes are merged into `main` on GitHub, Render updates the site automatically. This ends any open session, so avoid merging changes during a class.
