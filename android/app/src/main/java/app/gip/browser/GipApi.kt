package app.gip.browser

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.LocalDate

/** Actions qui nécessitent l'activité (interface, presse-papiers, fichiers…). */
interface GipHost {
    fun lock()
    fun emit(channel: String, payload: Any?)
    fun copyToClipboard(text: String, sensitive: Boolean)
    fun clearWebData(types: List<String>)
    fun saveToDownloads(name: String, mime: String, bytes: ByteArray): Boolean
    fun openDownload(id: String): Boolean
    fun onSettingsChanged()
    fun onAuthenticated()
    fun versionName(): String
}

/** Dispatch des appels `gip.call(method, arg)` des pages internes — équivalent de l'objet API de main.js. */
class GipApi(private val store: GipStore, private val host: GipHost) {

    val engines = linkedMapOf(
        "gip" to ("Gip Search" to "gip://search?q=%s"),
        "duckduckgo" to ("DuckDuckGo" to "https://duckduckgo.com/?q=%s"),
        "qwant" to ("Qwant" to "https://www.qwant.com/?q=%s"),
        "startpage" to ("Startpage" to "https://www.startpage.com/do/search?q=%s"),
        "brave" to ("Brave Search" to "https://search.brave.com/search?q=%s"),
        "ecosia" to ("Ecosia" to "https://www.ecosia.org/search?q=%s"),
        "google" to ("Google" to "https://www.google.com/search?q=%s"),
        "bing" to ("Bing" to "https://www.bing.com/search?q=%s")
    )

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
    fun searchUrl(q: String, engine: String = store.settings.optString("searchEngine", "gip")) =
        (engines[engine] ?: engines["gip"]!!).second.replace("%s", enc(q))
    private fun enginesJson() = JSONObject().also { o -> engines.forEach { (k, v) -> o.put(k, v.first) } }

    private fun need(): JSONObject = store.data
    private fun needAccount(): JSONObject { if (store.isGuest) throw GipError("Cette fonction nécessite un compte Gip (mode invité)"); return store.data }

    private fun JSONObject.arr(k: String): JSONArray = optJSONArray(k) ?: JSONArray().also { put(k, it) }
    private fun o(arg: Any?) = arg as? JSONObject ?: JSONObject()
    private fun s(arg: Any?) = when (arg) { null, JSONObject.NULL -> ""; else -> arg.toString() }

    fun call(method: String, arg: Any?): Any? = when (method) {
        /* ------- Authentification (écran de verrouillage Android) ------- */
        "auth.state" -> JSONObject().put("accounts", store.listAccounts()).put("loggedIn", store.loggedIn)
        "auth.create" -> o(arg).let { store.createAccount(it.optString("name"), it.optString("password"), it.optString("color").ifEmpty { null }).also { host.onAuthenticated() } }
        "auth.login" -> o(arg).let { store.login(it.optString("id"), it.optString("password")).also { host.onAuthenticated() } }
        "auth.guest" -> store.loginGuest().also { host.onAuthenticated() }

        "app.info" -> JSONObject().put("version", host.versionName()).put("electron", "—").put("chrome", android.webkit.WebView.getCurrentWebViewPackage()?.versionName ?: "?")
            .put("node", "—").put("v8", "—").put("platform", "android " + android.os.Build.VERSION.RELEASE).put("arch", android.os.Build.SUPPORTED_ABIS.firstOrNull() ?: "")
            .put("adRules", Shield.adCount).put("trackerRules", Shield.trackerCount).put("engines", enginesJson())

        "app.copy" -> { host.copyToClipboard(s(arg), false); true }
        "account.get" -> JSONObject().put("account", store.session?.let { store.publicAccount(it.account) } ?: JSONObject.NULL)
            .put("guest", store.isGuest).put("address", store.session?.let { it.account.optString("handle") + "@gip.local" } ?: JSONObject.NULL).put("accounts", store.listAccounts())
        "account.update" -> o(arg).let { store.updateAccount(it.optString("name").ifEmpty { null }, it.optString("color").ifEmpty { null }) }.also { host.emit("account:changed", it) }
        "account.changePassword" -> o(arg).let { store.changePassword(it.optString("oldPassword"), it.optString("newPassword")); true }
        "account.delete" -> { store.deleteAccount(o(arg).optString("password")); host.clearWebData(listOf("cookies", "storage", "cache")); host.lock(); true }
        "account.lock" -> { host.lock(); true }
        "account.export" -> { val d = JSONObject(needAccount().toString()); d.remove("keys")
            host.saveToDownloads("gip-export-" + store.session!!.account.optString("handle") + ".json", "application/json", d.toString(2).toByteArray()) }

        "settings.get" -> store.settings
        "settings.set" -> setSettings(o(arg))

        "history.list" -> { val a = o(arg); val q = a.optString("q").lowercase(); val limit = a.optInt("limit", 300); val off = a.optInt("offset", 0)
            val list = need().arr("history").objects().filter { q.isEmpty() || (it.optString("title") + " " + it.optString("url")).lowercase().contains(q) }
            JSONObject().put("total", list.size).put("items", JSONArray(list.drop(off).take(limit))) }
        "history.delete" -> { val ids = if (arg is JSONArray) (0 until arg.length()).map { arg.getString(it) }.toSet() else setOf(s(arg))
            store.update { d -> d.put("history", d.arr("history").filterObj { it.optString("id") !in ids }) }; true }
        "history.clear" -> { val since = o(arg).optLong("since", 0)
            store.update { d -> d.put("history", if (since > 0) d.arr("history").filterObj { it.optLong("date") < since } else JSONArray()) }; true }

        "bookmarks.list" -> need().arr("bookmarks")
        "bookmarks.add" -> { val a = o(arg); store.update { d -> if (d.arr("bookmarks").findObj { it.optString("url") == a.optString("url") } == null)
            d.arr("bookmarks").put(JSONObject().put("id", GipStore.uid(6)).put("url", a.optString("url")).put("title", a.optString("title").ifEmpty { a.optString("url") }).put("date", GipStore.now())) }
            bookmarksChanged() }
        "bookmarks.update" -> { val a = o(arg); store.update { d -> d.arr("bookmarks").findObj { it.optString("id") == a.optString("id") }?.let { b ->
            if (a.optString("url").isNotEmpty()) b.put("url", a.optString("url")); if (a.optString("title").isNotEmpty()) b.put("title", a.optString("title")) } }; bookmarksChanged() }
        "bookmarks.remove" -> { val id = s(arg); store.update { d -> d.put("bookmarks", d.arr("bookmarks").filterObj { it.optString("id") != id }) }; bookmarksChanged() }
        "bookmarks.move" -> { val a = o(arg); store.update { d -> val l = d.arr("bookmarks").objects().toMutableList(); val i = l.indexOfFirst { it.optString("id") == a.optString("id") }
            if (i >= 0) { val b = l.removeAt(i); l.add(a.optInt("to").coerceIn(0, l.size), b); d.put("bookmarks", JSONArray(l)) } }; bookmarksChanged() }

        "speedDial.get" -> need().arr("speedDial")
        "speedDial.set" -> { val l = (arg as? JSONArray)?.objects()?.take(24) ?: emptyList()
            store.update { d -> d.put("speedDial", JSONArray(l.map { JSONObject().put("title", it.optString("title").take(60)).put("url", it.optString("url")) })) }; need().arr("speedDial") }

        "downloads.list" -> need().arr("downloads")
        "downloads.action" -> o(arg).let { a -> when (a.optString("action")) {
            "open", "show" -> host.openDownload(a.optString("id"))
            "remove" -> { store.update { d -> d.put("downloads", d.arr("downloads").filterObj { it.optString("id") != a.optString("id") }) }; true }
            else -> false } }
        "downloads.clear" -> { store.update { d -> d.put("downloads", JSONArray()) }; true }

        "notes.list" -> need().arr("notes")
        "notes.save" -> { val n = o(arg); store.update { d ->
            val clean = JSONObject().put("title", n.optString("title").take(300)).put("body", n.optString("body").take(500000)).put("color", n.optString("color").ifEmpty { "#7c5cff" })
                .put("pinned", n.optBoolean("pinned")).put("date", GipStore.now())
            val ex = d.arr("notes").findObj { it.optString("id") == n.optString("id") && n.optString("id").isNotEmpty() }
            if (ex != null) { clean.keys().forEach { ex.put(it, clean.get(it)) }; ex } else { clean.put("id", GipStore.uid(6)); d.put("notes", d.arr("notes").prepend(clean)); clean } } }
        "notes.delete" -> { val id = s(arg); store.update { d -> d.put("notes", d.arr("notes").filterObj { it.optString("id") != id }) }; true }

        "vault.list" -> needAccount().arr("vault")
        "vault.save" -> { needAccount(); val v = o(arg); store.update { d ->
            val clean = JSONObject().put("site", v.optString("site").take(300)).put("username", v.optString("username").take(300)).put("password", v.optString("password").take(1000))
                .put("notes", v.optString("notes").take(5000)).put("updated", GipStore.now())
            val ex = d.arr("vault").findObj { it.optString("id") == v.optString("id") && v.optString("id").isNotEmpty() }
            if (ex != null) { clean.keys().forEach { ex.put(it, clean.get(it)) }; ex } else { clean.put("id", GipStore.uid(6)).put("created", GipStore.now()); d.put("vault", d.arr("vault").prepend(clean)); clean } } }
        "vault.delete" -> { val id = s(arg); store.update { d -> d.put("vault", d.arr("vault").filterObj { it.optString("id") != id }) }; true }
        "vault.generate" -> genPassword(o(arg))
        "vault.copy" -> { host.copyToClipboard(s(arg), true); true }
        "vault.breachCheck" -> breachCheck(s(arg))

        "mail.inbox" -> { needAccount(); store.inbox() }
        "mail.sent" -> needAccount().getJSONObject("mail").getJSONArray("sent")
        "mail.send" -> o(arg).let { store.sendMail(it.optString("to"), it.optString("subject"), it.optString("body")) }.also { mailChanged() }
        "mail.read" -> { store.markRead(s(arg)); mailChanged(); true }
        "mail.delete" -> { store.deleteMail(s(arg)); mailChanged(); true }
        "mail.directory" -> store.directory()
        "mail.unread" -> if (store.loggedIn && !store.isGuest) store.unreadCount() else 0

        "drive.list" -> JSONObject().put("files", needAccount().arr("drive")).put("usage", store.driveUsage())
        "drive.upload" -> o(arg).let { a -> val b = a.opt("bytes")
            val bytes = if (b is JSONObject) GipCrypto.unb64(b.optString("__b64")) else ByteArray(0)
            store.driveUpload(a.optString("name"), a.optString("type"), bytes) }
        "drive.delete" -> { store.driveDelete(s(arg)); true }
        "drive.rename" -> { val a = o(arg); store.update { d -> d.arr("drive").findObj { it.optString("id") == a.optString("id") }?.put("name", a.optString("name").take(200)) }; true }
        "drive.preview" -> { val (meta, bytes) = store.driveRead(s(arg))
            if (bytes.size > 12 * 1024 * 1024) JSONObject.NULL
            else JSONObject().put("type", meta.optString("type")).put("name", meta.optString("name")).put("dataUrl", "data:" + meta.optString("type") + ";base64," + GipCrypto.b64(bytes)) }
        "drive.save" -> { val (meta, bytes) = store.driveRead(s(arg)); host.saveToDownloads(meta.optString("name"), meta.optString("type"), bytes) }

        "agenda.list" -> need().arr("events")
        "agenda.save" -> { val e = o(arg); store.update { d ->
            val clean = JSONObject().put("title", e.optString("title").ifEmpty { "Événement" }.take(200)).put("date", e.optString("date")).put("time", e.optString("time"))
                .put("notes", e.optString("notes").take(5000)).put("color", e.optString("color").ifEmpty { "#7c5cff" })
            val ex = d.arr("events").findObj { it.optString("id") == e.optString("id") && e.optString("id").isNotEmpty() }
            if (ex != null) { clean.keys().forEach { ex.put(it, clean.get(it)) }; ex } else { clean.put("id", GipStore.uid(6)); d.arr("events").put(clean); clean } } }
        "agenda.delete" -> { val id = s(arg); store.update { d -> d.put("events", d.arr("events").filterObj { it.optString("id") != id }) }; true }

        "privacy.stats" -> JSONObject().put("stats", need().optJSONObject("stats")).put("settings", store.settings).put("sitePermissions", store.settings.optJSONObject("sitePermissions") ?: JSONObject())
        "privacy.clear" -> { val types = (o(arg).optJSONArray("types") ?: JSONArray()).let { a -> (0 until a.length()).map { a.getString(it) } }
            host.clearWebData(types)
            if ("history" in types) store.update { d -> d.put("history", JSONArray()); d.put("closedTabs", JSONArray()) }
            if ("downloads" in types) store.update { d -> d.put("downloads", JSONArray()) }
            if ("permissions" in types) store.update { d -> d.getJSONObject("settings").put("sitePermissions", JSONObject()) }
            true }
        "privacy.allowHttp" -> { Shield.httpExceptions.add(s(arg)); true }
        "privacy.resetStats" -> { store.update { d -> d.put("stats", JSONObject().put("blockedTotal", 0).put("upgradedTotal", 0).put("cookiesBlockedTotal", 0).put("paramsStripped", 0)) }; true }

        "search.query" -> o(arg).let { GipSearch.query(it.optString("q"), it.optInt("page", 0)) }
        "search.suggest" -> JSONArray(GipSearch.suggest(s(arg)))
        "search.engines" -> enginesJson()
        "search.external" -> o(arg).let { searchUrl(it.optString("q"), it.optString("engine").let { e -> if (e == "gip" || e !in engines) "duckduckgo" else e }) }

        "home.summary" -> { val d = need(); val today = LocalDate.now().toString()
            JSONObject().put("account", store.publicAccount(store.session!!.account)).put("guest", store.isGuest).put("speedDial", d.arr("speedDial"))
                .put("stats", d.optJSONObject("stats")).put("settings", store.settings).put("unread", if (store.isGuest) 0 else store.unreadCount())
                .put("notes", JSONArray(d.arr("notes").objects().filter { it.optBoolean("pinned") }.take(3)))
                .put("events", JSONArray(d.arr("events").objects().filter { it.optString("date") >= today }.sortedBy { it.optString("date") + it.optString("time") }.take(4)))
                .put("recent", JSONArray(d.arr("history").objects().take(6))) }

        else -> throw GipError("Méthode inconnue : $method")
    }

    private fun bookmarksChanged(): JSONArray { val b = need().arr("bookmarks"); host.emit("bookmarks:changed", b); return b }
    private fun mailChanged() { host.emit("mail:new", JSONObject()); host.emit("mail:unread", if (store.isGuest) 0 else store.unreadCount()) }

    fun setSettings(patch: JSONObject): JSONObject {
        store.update { d -> val s = d.getJSONObject("settings")
            for (k in patch.keys()) if (s.has(k)) s.put(k, patch.get(k)) }
        host.onSettingsChanged()
        host.emit("settings:changed", store.settings)
        return store.settings
    }

    private fun genPassword(o: JSONObject): String {
        var chars = ""
        if (o.optBoolean("lower", true)) chars += "abcdefghijkmnopqrstuvwxyz"
        if (o.optBoolean("upper", true)) chars += "ABCDEFGHJKLMNPQRSTUVWXYZ"
        if (o.optBoolean("digits", true)) chars += "23456789"
        if (o.optBoolean("symbols", true)) chars += "!@#\$%^&*()-_=+[]{};:,.?/"
        if (chars.isEmpty()) chars = "abcdefghijkmnopqrstuvwxyz"
        val len = o.optInt("length", 20).coerceIn(6, 128)
        return (1..len).map { chars[GipCrypto.randomInt(chars.length)] }.joinToString("")
    }

    private fun breachCheck(password: String): JSONObject {
        // k-anonymat : seuls les 5 premiers caractères du SHA-1 quittent l'appareil
        val h = GipCrypto.sha1Hex(password)
        return try {
            val c = URL("https://api.pwnedpasswords.com/range/" + h.take(5)).openConnection() as HttpURLConnection
            c.setRequestProperty("Add-Padding", "true"); c.connectTimeout = 8000; c.readTimeout = 8000
            val line = c.inputStream.bufferedReader().readLines().firstOrNull { it.startsWith(h.substring(5)) }
            JSONObject().put("checked", true).put("count", line?.substringAfter(':')?.trim()?.toIntOrNull() ?: 0)
        } catch (e: Exception) { JSONObject().put("checked", false).put("count", 0) }
    }
}
