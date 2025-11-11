import { Client, GatewayIntentBits, Partials, PermissionsBitField, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Routes, REST } from "discord.js"
import dotenv from "dotenv"
import fs from "fs"
dotenv.config()

const env = k => (process.env[k]?.trim?.() ?? null)
const TOKEN = env("TOKEN")
const CLIENT_ID = env("CLIENT_ID")
const ADMIN_ROLE_ID = env("ADMIN_ROLE_ID")
const DEFAULT_PANEL_IMAGE = env("PANEL_IMAGE_URL") || "https://i.imgur.com/2nL4D94.png"
const PANEL_CHANNEL_ID = env("PANEL_CHANNEL_ID")
const TICKETS_CATEGORY_ID = env("TICKETS_CATEGORY_ID")
const CATEGORY_SUPPORT_ID = env("CATEGORY_SUPPORT_ID")
const CATEGORY_DOACOES_ID = env("CATEGORY_DOACOES_ID")
const CATEGORY_APELACAO_ID = env("CATEGORY_APELACAO_ID")
const LOG_CHANNEL_ID = env("LOG_CHANNEL_ID")
const PANEL_POST_CHANNEL_ID = "1437589467379663048"

const cfgPath = "./config.json"
const defaultCfg = {
  panel: { title: "Rage System", description: "Estamos aqui para ajudar você da melhor forma possível. Abra um novo ticket para registrar sua solicitação, dúvida, compras ou problema — nossa equipe entrará em contato o mais breve possível.", image: DEFAULT_PANEL_IMAGE, color: 0xffffff },
  ticket: { titlePrefix: "Ticket • ", description: "aguarde um atendente. Use o botão abaixo para fechar quando resolver.", image: null, color: 0xffffff }
}
let config = defaultCfg
if (fs.existsSync(cfgPath)) {
  try { config = JSON.parse(fs.readFileSync(cfgPath, "utf8")) } catch { config = defaultCfg }
}
const saveCfg = () => { try { fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2)) } catch {} }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers], partials: [Partials.Channel] })

const kinds = [
  { key: "support", label: "Suporte", emoji: "🛠️", cat: () => CATEGORY_SUPPORT_ID || TICKETS_CATEGORY_ID || null },
  { key: "doacoes", label: "Doações", emoji: "💸", cat: () => CATEGORY_DOACOES_ID || TICKETS_CATEGORY_ID || null },
  { key: "apelacao", label: "Apelação", emoji: "⚖️", cat: () => CATEGORY_APELACAO_ID || TICKETS_CATEGORY_ID || null }
]

const makePanel = () => {
  const embed = new EmbedBuilder().setTitle(config.panel.title).setDescription(config.panel.description).setColor(config.panel.color)
  if (config.panel.image) embed.setImage(config.panel.image)
  const row = new ActionRowBuilder().addComponents(...kinds.map(k => new ButtonBuilder().setCustomId(`open_${k.key}`).setLabel(k.label).setEmoji(k.emoji).setStyle(ButtonStyle.Secondary)))
  return { embed, row }
}

const makeTicketEmbed = (userId, label) => {
  const e = new EmbedBuilder().setTitle(`${config.ticket.titlePrefix}${label}`).setDescription(`<@${userId}> ${config.ticket.description}`).setColor(config.ticket.color)
  if (config.ticket.image) e.setImage(config.ticket.image)
  return e
}

const log = async (guild, msg) => {
  console.log(`[tickets] ${msg}`)
  if (!LOG_CHANNEL_ID) return
  const ch = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null)
  if (ch) await ch.send({ content: `\`\`\`${msg}\`\`\`` }).catch(() => {})
}

const resolveCategory = async (guild, id) => {
  if (!id) return { parent: null, reason: "sem_id" }
  const ch = await guild.channels.fetch(id).catch(() => null)
  if (!ch) return { parent: null, reason: "nao_encontrada" }
  if (ch.type !== ChannelType.GuildCategory) return { parent: null, reason: "nao_e_categoria" }
  const me = guild.members.me
  const ok = me.permissionsIn(ch).has(PermissionsBitField.Flags.ManageChannels)
  if (!ok) return { parent: null, reason: "sem_permissao_manage_channels" }
  return { parent: ch, reason: "ok" }
}

const isAdmin = async (interaction) => {
  const member = await interaction.guild.members.fetch(interaction.user.id)
  return member.permissions.has(PermissionsBitField.Flags.Administrator) || (ADMIN_ROLE_ID && member.roles.cache.has(ADMIN_ROLE_ID))
}

const parseColor = (v) => {
  if (typeof v !== "string") return null
  const s = v.trim().replace(/^#/, "")
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  return parseInt(s, 16)
}

client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN)
  const commands = [
    { name: "ticketsetup", description: "Enviar o painel de tickets neste canal" },
    { name: "panelset", description: "Definir embed do painel", options: [{ name: "field", description: "Campo", type: 3, required: true, choices: [{ name: "title", value: "title" }, { name: "description", value: "description" }, { name: "image", value: "image" }, { name: "color", value: "color" }] }, { name: "value", description: "Valor", type: 3, required: true }] },
    { name: "ticketset", description: "Definir embed do ticket", options: [{ name: "field", description: "Campo", type: 3, required: true, choices: [{ name: "titleprefix", value: "titleprefix" }, { name: "description", value: "description" }, { name: "image", value: "image" }, { name: "color", value: "color" }] }, { name: "value", description: "Valor", type: 3, required: true }] },
    { name: "panelshow", description: "Pré-visualizar embed do painel" },
    { name: "ticketshow", description: "Pré-visualizar embed do ticket" },
    { name: "panelpost", description: "Publicar o painel no canal configurado" }
  ]
  for (const gid of [...client.guilds.cache.keys()]) await rest.put(Routes.applicationGuildCommands(CLIENT_ID, gid), { body: commands })
  if (PANEL_CHANNEL_ID) {
    const ch = await client.channels.fetch(PANEL_CHANNEL_ID).catch(() => null)
    if (ch) {
      const { embed, row } = makePanel()
      await ch.send({ embeds: [embed], components: [row] }).catch(() => {})
    }
  }
  console.log(`on ${client.user.tag}`)
})

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "ticketsetup") {
        if (!(await isAdmin(interaction))) return await interaction.reply({ content: "Sem permissão.", ephemeral: true })
        const { embed, row } = makePanel()
        await interaction.channel.send({ embeds: [embed], components: [row] })
        return await interaction.reply({ content: "Painel enviado.", ephemeral: true })
      }
      if (interaction.commandName === "panelset") {
        if (!(await isAdmin(interaction))) return await interaction.reply({ content: "Sem permissão.", ephemeral: true })
        const field = interaction.options.getString("field")
        const value = interaction.options.getString("value")
        if (field === "title") config.panel.title = value
        else if (field === "description") config.panel.description = value
        else if (field === "image") config.panel.image = value
        else if (field === "color") { const c = parseColor(value); if (!c) return await interaction.reply({ content: "Cor inválida. Use hex, ex: #ffffff", ephemeral: true }); config.panel.color = c }
        saveCfg()
        return await interaction.reply({ content: "Panel atualizado.", ephemeral: true })
      }
      if (interaction.commandName === "ticketset") {
        if (!(await isAdmin(interaction))) return await interaction.reply({ content: "Sem permissão.", ephemeral: true })
        const field = interaction.options.getString("field")
        const value = interaction.options.getString("value")
        if (field === "titleprefix") config.ticket.titlePrefix = value
        else if (field === "description") config.ticket.description = value
        else if (field === "image") config.ticket.image = value
        else if (field === "color") { const c = parseColor(value); if (!c) return await interaction.reply({ content: "Cor inválida. Use hex, ex: #ffffff", ephemeral: true }); config.ticket.color = c }
        saveCfg()
        return await interaction.reply({ content: "Ticket embed atualizado.", ephemeral: true })
      }
      if (interaction.commandName === "panelshow") {
        if (!(await isAdmin(interaction))) return await interaction.reply({ content: "Sem permissão.", ephemeral: true })
        const { embed } = makePanel()
        return await interaction.reply({ embeds: [embed], ephemeral: true })
      }
      if (interaction.commandName === "ticketshow") {
        if (!(await isAdmin(interaction))) return await interaction.reply({ content: "Sem permissão.", ephemeral: true })
        const e = makeTicketEmbed(interaction.user.id, "Prévia")
        return await interaction.reply({ embeds: [e], ephemeral: true })
      }
      if (interaction.commandName === "panelpost") {
        if (!(await isAdmin(interaction))) return await interaction.reply({ content: "Sem permissão.", ephemeral: true })
        const ch = await interaction.guild.channels.fetch(PANEL_POST_CHANNEL_ID).catch(() => null)
        if (!ch) return await interaction.reply({ content: "Canal alvo não encontrado.", ephemeral: true })
        const { embed, row } = makePanel()
        await ch.send({ embeds: [embed], components: [row] }).catch(() => {})
        return await interaction.reply({ content: `Painel publicado em <#${PANEL_POST_CHANNEL_ID}>.`, ephemeral: true })
      }
    }

    if (!interaction.isButton()) return
    if (!interaction.customId.startsWith("open_")) return

    const key = interaction.customId.replace("open_", "")
    const kind = kinds.find(k => k.key === key)
    if (!kind) return

    const existing = interaction.guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.topic === interaction.user.id)
    if (existing) return await interaction.reply({ content: `Você já tem um ticket aberto: ${existing}`, ephemeral: true })

    const wantParentId = kind.cat()
    const { parent, reason } = await resolveCategory(interaction.guild, wantParentId)
    await log(interaction.guild, `abrir ticket key=${key} user=${interaction.user.id} wantParent=${wantParentId} resolved=${parent?.id || "null"} reason=${reason}`)

    const name = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}-${Math.floor(Math.random() * 1000)}`
    const overwrites = [
      { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }
    ]
    if (ADMIN_ROLE_ID) overwrites.push({ id: ADMIN_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] })

    let channel = await interaction.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parent?.id ?? null,
      topic: interaction.user.id,
      permissionOverwrites: overwrites
    }).catch(async err => {
      await log(interaction.guild, `falha create parent=${parent?.id || "null"} code=${err?.code || "?"} msg=${err?.message || "?"}`)
      return null
    })

    if (!channel) return await interaction.reply({ content: "Falha ao criar o canal do ticket. Veja os logs.", ephemeral: true })

    if (parent && channel.parentId !== parent.id) {
      const moved = await channel.setParent(parent.id).then(() => true).catch(async err => {
        await log(interaction.guild, `falha mover channel=${channel.id} para parent=${parent.id} code=${err?.code || "?"}`)
        return false
      })
      await log(interaction.guild, `mover resultado=${moved} channel.parent=${channel.parentId}`)
    }

    const openEmbed = makeTicketEmbed(interaction.user.id, kind.label)
    const closeRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("ticket_close").setLabel("Fechar").setEmoji("🔒").setStyle(ButtonStyle.Secondary))
    const pingAdmins = ADMIN_ROLE_ID ? `<@&${ADMIN_ROLE_ID}>` : ""
    await channel.send({ content: pingAdmins, embeds: [openEmbed], components: [closeRow] })
    await interaction.reply({ content: `Ticket criado: ${channel}`, ephemeral: true })
  } catch (e) {
    try { await interaction.reply({ content: "Erro inesperado.", ephemeral: true }) } catch {}
    try { if (interaction.guild) await log(interaction.guild, `erro: ${e?.message || e}`) } catch {}
  }
})

client.login(TOKEN)
