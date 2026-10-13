package app.gip.browser

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class GipStoreTest {
    private class FakeHost : GipHost {
        val events = mutableListOf<String>()
        var authed = 0
        override fun lock() {}
        override fun emit(channel: String, payload: Any?) { events += channel }
        override fun copyToClipboard(text: String, sensitive: Boolean) {}
        override fun clearWebData(types: List<String>) {}
        override fun saveToDownloads(name: String, mime: String, bytes: ByteArray) = true
        override fun openDownload(id: String) = false
        override fun onSettingsChanged() {}
        override fun onAuthenticated() { authed++ }
        override fun versionName() = "2.0.0"
    }

    @Test fun chiffrementMailDriveEtMotDePasse() {
        val dir = Files.createTempDirectory("gip").toFile()
        val s = GipStore(dir)
        val api = GipApi(s, FakeHost())
        val alice = api.call("auth.create", JSONObject().put("name", "Alice").put("password", "alice123")) as JSONObject
        api.call("notes.save", JSONObject().put("title", "secret").put("body", "TOPSECRET"))
        val f = s.driveUpload("a.txt", "text/plain", "FICHIERSECRET".toByteArray())
        s.flush()
        val raw = dir.resolve("gip/profiles/${alice.getString("id")}.gip").readBytes()
        assertFalse("profil non chiffré", String(raw, Charsets.ISO_8859_1).contains("TOPSECRET"))
        s.logout()

        api.call("auth.create", JSONObject().put("name", "Bob").put("password", "bob12345"))
        api.call("mail.send", JSONObject().put("to", "alice@gip.local").put("subject", "Salut").put("body", "MESSAGESECRET"))
        assertFalse(dir.resolve("gip/mail/${alice.getString("id")}.json").readText().contains("MESSAGESECRET"))
        s.logout()

        try { s.login(alice.getString("id"), "mauvais"); fail("mot de passe accepté") } catch (e: GipError) { assertEquals("Mot de passe incorrect", e.message) }
        api.call("auth.login", JSONObject().put("id", alice.getString("id")).put("password", "alice123"))
        val inbox = api.call("mail.inbox", null) as JSONArray
        assertEquals("MESSAGESECRET", inbox.getJSONObject(0).getString("body"))
        assertEquals("Bob", inbox.getJSONObject(0).getString("from"))
        assertEquals(1, api.call("mail.unread", null))
        assertEquals("FICHIERSECRET", String(s.driveRead(f.getString("id")).second))

        s.changePassword("alice123", "nouveau99"); s.logout()
        s.login(alice.getString("id"), "nouveau99")
        assertEquals("FICHIERSECRET", String(s.driveRead(f.getString("id")).second))
        val notes = api.call("notes.list", null) as JSONArray
        assertTrue(notes.objects().any { it.optString("body") == "TOPSECRET" })

        val summary = api.call("home.summary", null) as JSONObject
        assertEquals("Alice", summary.getJSONObject("account").getString("name"))
        assertEquals(20, (api.call("vault.generate", JSONObject().put("length", 20)) as String).length)
        api.call("bookmarks.add", JSONObject().put("url", "https://exemple.fr").put("title", "Ex"))
        assertTrue((api.call("bookmarks.list", null) as JSONArray).objects().any { it.optString("url") == "https://exemple.fr" })
        api.call("settings.set", JSONObject().put("theme", "light").put("inconnu", 1))
        assertEquals("light", s.settings.getString("theme")); assertFalse(s.settings.has("inconnu"))
        try { api.call("nimporte", null); fail() } catch (e: GipError) {}
    }

    @Test fun invitePasDeMail() {
        val s = GipStore(Files.createTempDirectory("gip").toFile())
        val api = GipApi(s, FakeHost())
        api.call("auth.guest", null)
        try { api.call("mail.inbox", null); fail() } catch (e: GipError) {}
        assertFalse(s.settings.getBoolean("saveHistory"))
    }
}
