package app.gip.browser

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.Normalizer
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Comptes locaux et stockage chiffré — équivalent Android de src/main/store.js.
 * Tout le profil (historique, favoris, notes, coffre, Drive, agenda, mails envoyés)
 * est chiffré en AES-256-GCM avec la clé dérivée du mot de passe.
 */
class GipStore(base: File) {
    private val dir = File(base, "gip").apply { mkdirs() }
    private val profilesDir = File(dir, "profiles").apply { mkdirs() }
    private val mailDir = File(dir, "mail").apply { mkdirs() }
    private val driveDir = File(dir, "drive").apply { mkdirs() }
    private val indexFile = File(dir, "accounts.json")
    private val saver = Executors.newSingleThreadScheduledExecutor()
    private var pending: ScheduledFuture<*>? = null

    var accounts: JSONArray = readJson(indexFile)?.let { JSONArray(it) } ?: JSONArray()
        private set

    class Session(val account: JSONObject, var key: ByteArray?, val data: JSONObject, val guest: Boolean)

    @Volatile var session: Session? = null
        private set

    val loggedIn get() = session != null
    val isGuest get() = session?.guest == true
    val data: JSONObject get() = session?.data ?: throw GipError("Gip est verrouillé")
    val settings: JSONObject get() = session?.data?.optJSONObject("settings") ?: defaultSettings("#7c5cff")

    companion object {
        val COLORS = listOf("#7c5cff", "#00c2ff", "#ff5c8a", "#ffb547", "#2ee59d", "#ff7a45", "#a259ff", "#4d7cff")

        fun uid(n: Int = 12): String = GipCrypto.random(n / 2 + 1).joinToString("") { "%02x".format(it) }.take(n)
        fun now() = System.currentTimeMillis()

        fun defaultSettings(accent: String) = JSONObject().apply {
            put("searchEngine", "gip"); put("homepage", "gip://home"); put("theme", "dark"); put("accent", accent)
            put("blockAds", true); put("blockTrackers", true); put("httpsOnly", true); put("sendGPC", true)
            put("blockThirdPartyCookies", true); put("fingerprintProtection", true); put("stripTrackingParams", true)
            put("clearOnExit", false); put("saveHistory", true); put("showBookmarksBar", true); put("animations", true)
            put("wallpaper", "aurora"); put("zoom", 1); put("sitePermissions", JSONObject())
        }

        private fun bm(title: String, url: String) = JSONObject().put("id", uid(6)).put("title", title).put("url", url).put("date", now())
        private fun dial(title: String, url: String) = JSONObject().put("title", title).put("url", url)

        fun emptyProfile(color: String): JSONObject {
            val (pub, priv) = GipCrypto.newKeyPair()
            return JSONObject().apply {
                put("version", 2)
                put("keys", JSONObject().put("publicKey", pub).put("privateKey", priv))
                put("settings", defaultSettings(color))
                put("bookmarks", JSONArray().put(bm("Gip Search", "gip://search")).put(bm("Gip Mail", "gip://mail")).put(bm("Gip Notes", "gip://notes")).put(bm("Wikipédia", "https://fr.m.wikipedia.org")))
                put("speedDial", JSONArray().put(dial("Wikipédia", "https://fr.m.wikipedia.org")).put(dial("YouTube", "https://m.youtube.com")).put(dial("GitHub", "https://github.com")).put(dial("OpenStreetMap", "https://www.openstreetmap.org")).put(dial("Le Monde", "https://www.lemonde.fr")).put(dial("Météo", "https://meteofrance.com")))
                put("history", JSONArray()); put("downloads", JSONArray())
                put("notes", JSONArray().put(JSONObject().put("id", uid(6)).put("title", "Bienvenue dans Gip Notes")
                    .put("body", "Vos notes sont chiffrées avec votre mot de passe.\nPersonne d'autre — pas même Gip — ne peut les lire.")
                    .put("color", "#7c5cff").put("pinned", true).put("date", now())))
                put("vault", JSONArray()); put("drive", JSONArray())
                put("mail", JSONObject().put("sent", JSONArray()).put("read", JSONArray()))
                put("events", JSONArray())
                put("stats", JSONObject().put("blockedTotal", 0).put("upgradedTotal", 0).put("cookiesBlockedTotal", 0).put("paramsStripped", 0))
                put("closedTabs", JSONArray()); put("lastSession", JSONArray())
            }
        }

        private fun readJson(f: File): String? = try { f.readText() } catch (e: Exception) { null }
    }

    private fun writeAtomic(f: File, bytes: ByteArray) {
        val tmp = File(f.parentFile, f.name + "." + uid(4) + ".tmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    }

    private fun saveIndex() = writeAtomic(indexFile, accounts.toString(2).toByteArray())
    private fun profileFile(id: String) = File(profilesDir, "$id.gip")

    fun publicAccount(a: JSONObject) = JSONObject().put("id", a.optString("id")).put("name", a.optString("name"))
        .put("color", a.optString("color")).put("handle", a.optString("handle")).put("createdAt", a.optLong("createdAt"))

    fun listAccounts() = JSONArray().also { arr -> for (i in 0 until accounts.length()) arr.put(publicAccount(accounts.getJSONObject(i))) }

    private fun findAccount(pred: (JSONObject) -> Boolean): JSONObject? {
        for (i in 0 until accounts.length()) { val a = accounts.getJSONObject(i); if (pred(a)) return a }
        return null
    }

    @Synchronized
    fun createAccount(nameIn: String, password: String, color: String?): JSONObject {
        val name = nameIn.trim().take(40)
        if (name.isEmpty()) throw GipError("Choisissez un nom")
        if (password.length < 6) throw GipError("Mot de passe : 6 caractères minimum")
        val base = Normalizer.normalize(name.lowercase(), Normalizer.Form.NFD).replace(Regex("[^a-z0-9]+"), ".").trim('.').ifEmpty { "user" }
        var handle = base; var i = 1
        while (findAccount { it.optString("handle") == handle } != null) handle = base + (++i)
        val salt = GipCrypto.random(16)
        val c = color ?: COLORS[accounts.length() % COLORS.size]
        val data = emptyProfile(c)
        val account = JSONObject().put("id", uid(16)).put("name", name).put("handle", handle).put("color", c)
            .put("salt", GipCrypto.b64(salt)).put("createdAt", now()).put("publicKey", data.getJSONObject("keys").getString("publicKey"))
        val key = GipCrypto.deriveKey(password, salt)
        writeAtomic(profileFile(account.getString("id")), GipCrypto.encrypt(key, data.toString().toByteArray()))
        accounts.put(account); saveIndex()
        session = Session(account, key, data, false)
        return publicAccount(account)
    }

    @Synchronized
    fun login(id: String, password: String): JSONObject {
        val account = findAccount { it.optString("id") == id } ?: throw GipError("Compte introuvable")
        val key = GipCrypto.deriveKey(password, GipCrypto.unb64(account.getString("salt")))
        val data = try { JSONObject(String(GipCrypto.decrypt(key, profileFile(id).readBytes()))) } catch (e: Exception) { throw GipError("Mot de passe incorrect") }
        // Complète les champs manquants (mises à jour)
        val shape = emptyProfile(account.optString("color"))
        for (k in shape.keys()) if (!data.has(k)) data.put(k, shape.get(k))
        val s = data.getJSONObject("settings"); val ds = defaultSettings(account.optString("color"))
        for (k in ds.keys()) if (!s.has(k)) s.put(k, ds.get(k))
        session = Session(account, key, data, false)
        return publicAccount(account)
    }

    @Synchronized
    fun loginGuest(): JSONObject {
        val account = JSONObject().put("id", "guest").put("name", "Invité").put("handle", "invite").put("color", "#8a8fa3").put("createdAt", now())
        val data = emptyProfile("#8a8fa3")
        data.getJSONObject("settings").put("saveHistory", false)
        session = Session(account, null, data, true)
        return publicAccount(account)
    }

    @Synchronized
    fun logout() { flush(); session = null }

    fun <T> update(fn: (JSONObject) -> T): T {
        val r = synchronized(this) { fn(data) }
        saveSoon(); return r
    }

    fun saveSoon() {
        if (session?.guest != false) return
        synchronized(this) {
            pending?.cancel(false)
            pending = saver.schedule({ flush() }, 400, TimeUnit.MILLISECONDS)
        }
    }

    @Synchronized
    fun flush() {
        val s = session ?: return
        if (s.guest || s.key == null) return
        writeAtomic(profileFile(s.account.getString("id")), GipCrypto.encrypt(s.key!!, s.data.toString().toByteArray()))
    }

    private fun requireAccount(): Session {
        val s = session ?: throw GipError("Gip est verrouillé")
        if (s.guest) throw GipError("Cette fonction nécessite un compte Gip (mode invité)")
        return s
    }

    @Synchronized
    fun changePassword(old: String, new: String) {
        val s = requireAccount()
        if (new.length < 6) throw GipError("Nouveau mot de passe trop court")
        val oldKey = GipCrypto.deriveKey(old, GipCrypto.unb64(s.account.getString("salt")))
        if (!oldKey.contentEquals(s.key)) throw GipError("Ancien mot de passe incorrect")
        val salt = GipCrypto.random(16)
        val newKey = GipCrypto.deriveKey(new, salt)
        File(driveDir, s.account.getString("id")).listFiles()?.forEach { f ->
            writeAtomic(f, GipCrypto.encrypt(newKey, GipCrypto.decrypt(oldKey, f.readBytes())))
        }
        s.account.put("salt", GipCrypto.b64(salt)); s.key = newKey
        saveIndex(); flush()
    }

    @Synchronized
    fun updateAccount(name: String?, color: String?): JSONObject {
        val s = requireAccount()
        if (!name.isNullOrBlank()) s.account.put("name", name.trim().take(40))
        if (!color.isNullOrBlank()) s.account.put("color", color)
        saveIndex(); return publicAccount(s.account)
    }

    @Synchronized
    fun deleteAccount(password: String) {
        val s = requireAccount()
        val key = GipCrypto.deriveKey(password, GipCrypto.unb64(s.account.getString("salt")))
        if (!key.contentEquals(s.key)) throw GipError("Mot de passe incorrect")
        val id = s.account.getString("id")
        profileFile(id).delete(); File(driveDir, id).deleteRecursively(); File(mailDir, "$id.json").delete()
        val keep = JSONArray(); for (i in 0 until accounts.length()) if (accounts.getJSONObject(i).optString("id") != id) keep.put(accounts.getJSONObject(i))
        accounts = keep; saveIndex(); session = null
    }

    /* ---------------------------- Gip Mail (E2E) ---------------------------- */

    private fun mailbox(id: String) = File(mailDir, "$id.json")

    fun directory() = JSONArray().also { arr ->
        for (i in 0 until accounts.length()) { val a = accounts.getJSONObject(i)
            arr.put(JSONObject().put("id", a.optString("id")).put("name", a.optString("name")).put("handle", a.optString("handle"))
                .put("color", a.optString("color")).put("address", a.optString("handle") + "@gip.local")) }
    }

    @Synchronized
    fun sendMail(to: String, subjectIn: String, body: String): String {
        val s = requireAccount()
        val handles = to.split(Regex("[,;\\s]+")).map { it.trim().lowercase().removeSuffix("@gip.local") }.filter { it.isNotEmpty() }
        if (handles.isEmpty()) throw GipError("Destinataire manquant")
        val targets = handles.map { h -> findAccount { it.optString("handle") == h || it.optString("id") == h } ?: throw GipError("Adresse inconnue : $h@gip.local") }
        val subject = subjectIn.ifBlank { "(sans objet)" }.take(300)
        val payload = JSONObject().put("subject", subject).put("body", body.take(200000)).toString().toByteArray()
        val msgId = uid(12); val date = now()
        for (acc in targets) {
            val (eph, blob) = GipCrypto.sealFor(acc.getString("publicKey"), payload)
            val env = JSONObject().put("id", msgId).put("from", s.account.optString("id")).put("fromName", s.account.optString("name"))
                .put("fromAddress", s.account.optString("handle") + "@gip.local").put("to", acc.optString("id")).put("date", date).put("eph", eph).put("blob", blob)
            val f = mailbox(acc.getString("id"))
            val box = readJson(f)?.let { JSONArray(it) } ?: JSONArray()
            box.put(env); writeAtomic(f, box.toString().toByteArray())
        }
        update { d -> d.getJSONObject("mail").getJSONArray("sent").let { arr ->
            val n = JSONArray().put(JSONObject().put("id", msgId).put("to", JSONArray(targets.map { it.optString("handle") + "@gip.local" })).put("subject", subject).put("body", body).put("date", date))
            for (i in 0 until arr.length()) n.put(arr.get(i))
            d.getJSONObject("mail").put("sent", n)
        } }
        return msgId
    }

    fun inbox(): JSONArray {
        val s = session ?: return JSONArray()
        if (s.guest) return JSONArray()
        val priv = s.data.getJSONObject("keys").getString("privateKey")
        val read = s.data.getJSONObject("mail").getJSONArray("read").let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }
        val box = readJson(mailbox(s.account.getString("id")))?.let { JSONArray(it) } ?: JSONArray()
        val out = mutableListOf<JSONObject>()
        for (i in 0 until box.length()) {
            val env = box.getJSONObject(i)
            val o = JSONObject().put("id", env.optString("id")).put("from", env.optString("fromName")).put("fromAddress", env.optString("fromAddress")).put("date", env.optLong("date"))
            try {
                val m = JSONObject(String(GipCrypto.open(priv, env.getString("eph"), env.getString("blob"))))
                o.put("subject", m.optString("subject")).put("body", m.optString("body")).put("read", read.contains(env.optString("id"))).put("encrypted", true)
            } catch (e: Exception) {
                o.put("subject", "⚠ Message illisible").put("body", "Impossible de déchiffrer ce message.").put("read", true).put("encrypted", false)
            }
            out.add(o)
        }
        return JSONArray(out.sortedByDescending { it.optLong("date") })
    }

    fun unreadCount(): Int = try { val a = inbox(); (0 until a.length()).count { !a.getJSONObject(it).optBoolean("read") } } catch (e: Exception) { 0 }

    @Synchronized
    fun deleteMail(id: String) {
        val s = requireAccount()
        val f = mailbox(s.account.getString("id"))
        val box = readJson(f)?.let { JSONArray(it) } ?: JSONArray()
        val keep = JSONArray(); for (i in 0 until box.length()) if (box.getJSONObject(i).optString("id") != id) keep.put(box.get(i))
        writeAtomic(f, keep.toString().toByteArray())
        update { d -> val m = d.getJSONObject("mail"); m.put("sent", m.getJSONArray("sent").filterObj { it.optString("id") != id }) }
    }

    fun markRead(id: String) = update { d -> val r = d.getJSONObject("mail").getJSONArray("read"); if ((0 until r.length()).none { r.getString(it) == id }) r.put(id) }

    /* ------------------------------ Gip Drive ------------------------------ */

    private fun driveDirFor(s: Session) = File(driveDir, s.account.getString("id")).apply { mkdirs() }

    fun driveUpload(name: String, type: String, bytes: ByteArray): JSONObject {
        val s = requireAccount()
        if (bytes.size > 200 * 1024 * 1024) throw GipError("Fichier trop volumineux (200 Mo max)")
        val id = uid(12)
        writeAtomic(File(driveDirFor(s), "$id.bin"), GipCrypto.encrypt(s.key!!, bytes))
        val meta = JSONObject().put("id", id).put("name", name.take(200)).put("type", type.ifEmpty { "application/octet-stream" }).put("size", bytes.size).put("date", now())
        update { d -> d.put("drive", JSONArray().put(meta).also { n -> val a = d.getJSONArray("drive"); for (i in 0 until a.length()) n.put(a.get(i)) }) }
        return meta
    }

    fun driveRead(id: String): Pair<JSONObject, ByteArray> {
        val s = requireAccount()
        val meta = s.data.getJSONArray("drive").findObj { it.optString("id") == id } ?: throw GipError("Fichier introuvable")
        return meta to GipCrypto.decrypt(s.key!!, File(driveDirFor(s), "$id.bin").readBytes())
    }

    fun driveDelete(id: String) {
        val s = requireAccount()
        File(driveDirFor(s), "$id.bin").delete()
        update { d -> d.put("drive", d.getJSONArray("drive").filterObj { it.optString("id") != id }) }
    }

    fun driveUsage(): Long { val a = session?.data?.optJSONArray("drive") ?: return 0; return (0 until a.length()).sumOf { a.getJSONObject(it).optLong("size") } }
}

class GipError(msg: String) : Exception(msg)

fun JSONArray.filterObj(pred: (JSONObject) -> Boolean): JSONArray {
    val out = JSONArray(); for (i in 0 until length()) { val o = optJSONObject(i) ?: continue; if (pred(o)) out.put(o) }; return out
}
fun JSONArray.findObj(pred: (JSONObject) -> Boolean): JSONObject? {
    for (i in 0 until length()) { val o = optJSONObject(i) ?: continue; if (pred(o)) return o }; return null
}
fun JSONArray.prepend(o: Any): JSONArray { val n = JSONArray().put(o); for (i in 0 until length()) n.put(get(i)); return n }
fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
