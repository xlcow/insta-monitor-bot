require("dotenv").config();

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const fs = require("fs");
const cron = require("node-cron");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const DATA_FILE = "./data/users.json";
let users = [];

// Load / Save
function loadUsers() {
  try {
    users = JSON.parse(fs.readFileSync(DATA_FILE));
  } catch {
    users = [];
  }
}

function saveUsers() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

// Add user
function addUser(newUser) {
  if (!users.find(u => u.username === newUser.username && u.mode === newUser.mode)) {
    users.push(newUser);
    saveUsers();
  }
}

// 🔥 FINAL CHECK FUNCTION (ACCURATE + HTML SCRAPE)
async function checkInstagram(username, old = {}) {
  try {
    const page = await axios.get(
      `https://www.instagram.com/${username}/`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        validateStatus: () => true,
        timeout: 7000,
      }
    );

    // 🔴 BANNED / NOT FOUND
    if (page.status === 404) {
      return {
        status: "banned",
        followers: old.followers || null,
        profilePic: old.profilePic || null,
      };
    }

    // 🟢 ACTIVE
    if (page.status === 200) {
      const html = page.data;

      // followers
      const followerMatch = html.match(/"edge_followed_by":\{"count":(\d+)\}/);
      const followers = followerMatch ? parseInt(followerMatch[1]) : old.followers;

      // profile pic
      const picMatch = html.match(/"profile_pic_url_hd":"([^"]+)"/);
      const profilePic = picMatch
        ? picMatch[1].replace(/\\u0026/g, "&")
        : old.profilePic;

      return {
        status: "active",
        followers: followers,
        profilePic: profilePic,
      };
    }

    // fallback
    return {
      status: old.status || "active",
      followers: old.followers || null,
      profilePic: old.profilePic || null,
    };

  } catch {
    return {
      status: old.status || "active",
      followers: old.followers || null,
      profilePic: old.profilePic || null,
    };
  }
}

// Ready
client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  loadUsers();
});

// UI card
function sendCard(channel, username, result) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`@${username}`)
    .setDescription(
      result.status === "active"
        ? `🟢 ACTIVE\n👥 ${result.followers ? result.followers.toLocaleString() : "Hidden"} followers`
        : `🔴 BANNED`
    )
    .setThumbnail(
      result.profilePic ||
      "https://cdn-icons-png.flaticon.com/512/149/149071.png"
    );

  channel.send({ embeds: [embed] });
}

// Commands
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args[0];

  if (cmd === "!ban" || cmd === "!unban") {
    const usernames = args[1] === "list" ? args.slice(2) : [args[1]];

    for (let username of usernames) {
      if (!username) continue;

      const result = await checkInstagram(username);
      sendCard(message.channel, username, result);

      addUser({
        username,
        mode: cmd === "!ban" ? "ban" : "unban",
        lastStatus: result.status,
        bannedAt: result.status === "banned" ? Date.now() : null,
        followers: result.followers,
        profilePic: result.profilePic,
      });

      await new Promise(r => setTimeout(r, 2000));
    }
  }
});

// 🔁 MONITOR LOOP
cron.schedule("* * * * *", async () => {
  const channel = client.channels.cache.get(process.env.CHANNEL_ID);
  if (!channel) return;

  for (let user of users) {
    const result = await checkInstagram(user.username, user);

    if (result.followers) user.followers = result.followers;
    if (result.profilePic) user.profilePic = result.profilePic;

    // 🔴 BAN DETECT
    if (
      user.mode === "ban" &&
      result.status === "banned" &&
      user.lastStatus === "active"
    ) {
      user.bannedAt = Date.now();

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle(`Account BANNED | @${user.username} 🔴`)
        .setThumbnail(user.profilePic)
        .setTimestamp();

      channel.send({ embeds: [embed] });
    }

    // 🟢 UNBAN DETECT
    if (
      user.mode === "unban" &&
      result.status === "active" &&
      user.lastStatus === "banned"
    ) {
      const t = Date.now() - user.bannedAt;

      const m = Math.floor(t / 60000);
      const s = Math.floor((t % 60000) / 1000);

      const embed = new EmbedBuilder()
        .setColor(0x00ff99)
        .setTitle(`Account Recovered | @${user.username} 🏆✅`)
        .setDescription(
          `**Followers:** ${
            user.followers ? user.followers.toLocaleString() : "Hidden"
          }\n⏱ ${m}m ${s}s`
        )
        .setThumbnail(user.profilePic)
        .setTimestamp();

      channel.send({
        content: `Account Recovered | @${user.username} 🏆✅`,
        embeds: [embed],
      });
    }

    user.lastStatus = result.status;
    saveUsers();

    await new Promise(r => setTimeout(r, 4000));
  }
});

client.login(process.env.TOKEN);