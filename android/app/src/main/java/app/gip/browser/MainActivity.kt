package app.gip.browser

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.os.PersistableBundle
import android.provider.MediaStore
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.*
import android.widget.*
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors

class MainActivity : Activity(), GipHost {

    companion object {
        const val HOST = "gip.internal"
        const val BASE = "https://$HOST/"
        private val PAGES = setOf("home", "search", "settings", "history", "bookmarks", "downloads", "privacy", "mail", "notes", "vault", "drive", "agenda", "account", "about", "error", "auth")
        private const val REQ_FILE = 41
    }

    /* ------------------------------ État ------------------------------ */

    inner class Tab(val webView: WebView, val isPrivate: Boolean) {
        val id = GipStore.uid(8)
        @Volatile var url: String = ""
        @Volatile var topHost: String = ""
        @Volatile var isInternal = false
        var title = ""
        var favicon: Bitmap? = null
        var loading = false
        var ads = 0; var trackers = 0; var upgrades = 0; var params = 0
        val blockedHosts = LinkedHashSet<String>()
        var desktop = false
        var opener: Tab? = null
    }

    lateinit var store: GipStore
    lateinit var api: GipApi
    private val bg = Executors.newFixedThreadPool(3)
    private val ui = Handler(Looper.getMainLooper())
    private val tabs = mutableListOf<Tab>()
    private var current: Tab? = null
    private var authView: WebView? = null
    private var pendingUrl: String? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var customView: View? = null
    private var customCallback: WebChromeClient.CustomViewCallback? = null
    private val permCallbacks = HashMap<Int, (Boolean) -> Unit>()
    private var permSeq = 100
    private var downloadReceiver: BroadcastReceiver? = null
    private var suggestPopup: ListPopupWindow? = null

    private lateinit var root: FrameLayout
    private lateinit var topbar: LinearLayout
    private lateinit var bottombar: LinearLayout
    private lateinit var urlField: EditText
    private lateinit var siteIcon: ImageButton
    private lateinit var shieldIcon: ImageView
    private lateinit var shieldCount: TextView
    private lateinit var progress: ProgressBar
    private lateinit var container: FrameLayout
    private lateinit var tabsCount: TextView
    private lateinit var banner: TextView
    private lateinit var findbar: LinearLayout

    private val dp get() = resources.displayMetrics.density

    /* ------------------------------ Cycle de vie ------------------------------ */

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        Shield.load(this)
        store = GipStore(filesDir)
        api = GipApi(store, this)
        WebView.setWebContentsDebuggingEnabled(false)

        root = findViewById(R.id.root)
        topbar = findViewById(R.id.topbar)
        bottombar = findViewById(R.id.bottombar)
        urlField = findViewById(R.id.url)
        siteIcon = findViewById(R.id.siteIcon)
        shieldIcon = findViewById(R.id.shieldIcon)
        shieldCount = findViewById(R.id.shieldCount)
        progress = findViewById(R.id.progress)
        container = findViewById(R.id.webContainer)
        tabsCount = findViewById(R.id.tabsCount)
        banner = findViewById(R.id.banner)
        findbar = findViewById(R.id.findbar)

        applyInsets()
        bindChrome()
        registerDownloads()
        pendingUrl = urlFromIntent(intent)
        showLock(quick = false)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val u = urlFromIntent(intent) ?: return
        if (store.loggedIn && authView == null) newTab(u) else pendingUrl = u
    }

    override fun onPause() {
        super.onPause()
        saveSession()
        if (store.loggedIn) bg.execute { store.flush() }
    }

    override fun onDestroy() {
        if (store.loggedIn && store.settings.optBoolean("clearOnExit")) {
            clearWebData(listOf("cookies", "storage", "cache"))
            store.update { d -> d.put("history", JSONArray()); d.put("lastSession", JSONArray()); d.put("closedTabs", JSONArray()) }
        }
        store.flush()
        downloadReceiver?.let { unregisterReceiver(it) }
        super.onDestroy()
    }

    private fun applyInsets() {
        root.setOnApplyWindowInsetsListener { v, insets ->
            val top: Int; val bottom: Int; val left: Int; val right: Int
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                val ime = insets.getInsets(WindowInsets.Type.ime())
                top = bars.top; left = bars.left; right = bars.right; bottom = maxOf(bars.bottom, ime.bottom)
            } else {
                @Suppress("DEPRECATION")
                run { top = insets.systemWindowInsetTop; bottom = insets.systemWindowInsetBottom; left = insets.systemWindowInsetLeft; right = insets.systemWindowInsetRight }
            }
            val fullscreen = customView != null
            v.setPadding(if (fullscreen) 0 else left, if (fullscreen) 0 else top, if (fullscreen) 0 else right, if (fullscreen) 0 else bottom)
            insets
        }
        setChromeColor(false)
    }

    @Suppress("DEPRECATION")
    private fun setChromeColor(private: Boolean) {
        val c = getColor(if (private) R.color.chrome_private else R.color.chrome)
        topbar.setBackgroundColor(c); bottombar.setBackgroundColor(c); findbar.setBackgroundColor(c)
        root.setBackgroundColor(c)
        window.statusBarColor = c; window.navigationBarColor = c
    }

    private fun urlFromIntent(i: Intent?): String? = when (i?.action) {
        Intent.ACTION_VIEW -> i.dataString
        Intent.ACTION_WEB_SEARCH -> i.getStringExtra("query")?.let { resolveInput(it) }
        Intent.ACTION_SEND -> i.getStringExtra(Intent.EXTRA_TEXT)?.let { resolveInput(it.trim()) }
        else -> null
    }

    /* ------------------------------ Verrouillage ------------------------------ */

    private fun showLock(quick: Boolean) {
        hideSuggest()
        for (t in tabs.toList()) destroyTab(t)
        tabs.clear(); current = null
        topbar.visibility = View.GONE; bottombar.visibility = View.GONE; findbar.visibility = View.GONE; progress.visibility = View.INVISIBLE
        setChromeColor(false)
        val tab = Tab(createWebView(false), false)
        authView = tab.webView
        tab.webView.tag = tab
        container.addView(tab.webView, FrameLayout.LayoutParams(-1, -1))
        tab.webView.loadUrl(BASE + "auth" + if (quick) "?quick=1" else "")
    }

    override fun lock() {
        ui.post {
            saveSession()
            store.logout()
            showLock(quick = true)
        }
    }

    override fun onAuthenticated() {
        ui.post {
            val prefs = getSharedPreferences("gip", MODE_PRIVATE)
            val id = store.session?.account?.optString("id") ?: ""
            // Sépare les sessions web entre comptes : on efface cookies/stockage au changement de compte
            if (prefs.getString("lastAccount", null) != id) {
                clearWebData(listOf("cookies", "storage", "cache"))
                prefs.edit().putString("lastAccount", id).apply()
            }
            ui.postDelayed({ enterBrowser() }, 380)
        }
    }

    private fun enterBrowser() {
        authView?.let { container.removeView(it); it.destroy() }
        authView = null
        topbar.visibility = View.VISIBLE; bottombar.visibility = View.VISIBLE
        topbar.translationY = -80 * dp; topbar.alpha = 0f
        bottombar.translationY = 80 * dp; bottombar.alpha = 0f
        topbar.animate().translationY(0f).alpha(1f).setDuration(450).setInterpolator(android.view.animation.OvershootInterpolator(1.1f)).start()
        bottombar.animate().translationY(0f).alpha(1f).setDuration(450).setStartDelay(60).setInterpolator(android.view.animation.OvershootInterpolator(1.1f)).start()
        onSettingsChanged()
        val last = store.data.optJSONArray("lastSession")?.objects()?.map { it.optString("url") }?.filter { it.isNotEmpty() && !isHomeUrl(it) } ?: emptyList()
        newTab(pendingUrl ?: homepage())
        pendingUrl = null
        if (last.isNotEmpty() && !store.isGuest) {
            showBanner("↺ Restaurer ${last.size} onglet${if (last.size > 1) "s" else ""} de la session précédente", 9000) {
                for (u in last) newTab(u, background = true)
                showBanner("${last.size} onglet${if (last.size > 1) "s" else ""} restauré${if (last.size > 1) "s" else ""}")
            }
        }
    }

    /* ------------------------------ WebView ------------------------------ */

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(private: Boolean): WebView {
        val wv = WebView(this)
        wv.setBackgroundColor(getColor(R.color.bg))
        with(wv.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportZoom(true); builtInZoomControls = true; displayZoomControls = false
            loadWithOverviewMode = true; useWideViewPort = true
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false; allowContentAccess = false
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = userAgentString.replace("; wv", "").replace(Regex(" Version/\\d+\\.\\d+"), "")
            if (private) cacheMode = WebSettings.LOAD_NO_CACHE
            @Suppress("DEPRECATION") saveFormData = false
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, !store.settings.optBoolean("blockThirdPartyCookies", true))
        wv.addJavascriptInterface(Bridge(wv), "GipNative")
        if (store.settings.optBoolean("fingerprintProtection", true) && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            val js = assets.open("gip/assets/android/fingerprint.js").bufferedReader().readText().replace("__SEED__", GipCrypto.randomInt(Int.MAX_VALUE).toString())
            WebViewCompat.addDocumentStartJavaScript(wv, js, setOf("*"))
        }
        wv.webViewClient = Client()
        wv.webChromeClient = Chrome()
        wv.setDownloadListener { url, ua, cd, mime, _ -> download(url, ua, cd, mime, private) }
        wv.setOnLongClickListener { longPress(wv) }
        return wv
    }

    private fun tabOf(wv: WebView?): Tab? = wv?.tag as? Tab

    fun newTab(url: String, background: Boolean = false, private: Boolean = false, opener: Tab? = null): Tab {
        val wv = createWebView(private)
        val tab = Tab(wv, private)
        tab.opener = opener
        wv.tag = tab
        val idx = if (opener != null) tabs.indexOf(opener) + 1 else tabs.size
        tabs.add(idx.coerceIn(0, tabs.size), tab)
        wv.visibility = View.INVISIBLE
        container.addView(wv, FrameLayout.LayoutParams(-1, -1))
        if (url.isNotEmpty()) load(tab, url)
        if (!background) select(tab) else bumpTabs()
        updateTabsCount()
        return tab
    }

    private fun select(tab: Tab) {
        val prev = current
        current = tab
        for (t in tabs) if (t !== tab) t.webView.visibility = View.INVISIBLE
        tab.webView.visibility = View.VISIBLE
        if (prev !== tab) {
            tab.webView.alpha = 0f; tab.webView.scaleX = 0.97f; tab.webView.scaleY = 0.97f
            tab.webView.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(260).start()
        }
        setChromeColor(tab.isPrivate)
        closeFind()
        updateChrome()
    }

    private fun closeTab(tab: Tab) {
        val i = tabs.indexOf(tab)
        if (i < 0) return
        if (!tab.isPrivate && !tab.isInternal && tab.url.isNotEmpty()) store.update { d -> d.put("closedTabs", d.getJSONArray("closedTabs").prepend(JSONObject().put("url", tab.url).put("title", tab.title)).let { a -> JSONArray(a.objects().take(25)) }) }
        tabs.removeAt(i)
        destroyTab(tab)
        if (tabs.isEmpty()) newTab(homepage())
        else if (tab === current) select(tab.opener?.takeIf { it in tabs } ?: tabs[minOf(i, tabs.size - 1)])
        updateTabsCount(); saveSession()
    }

    private fun destroyTab(tab: Tab) {
        container.removeView(tab.webView)
        tab.webView.stopLoading()
        if (tab.isPrivate) tab.webView.clearCache(true)
        tab.webView.destroy()
        if (tab.isPrivate && tabs.none { it.isPrivate }) {
            // Dernier onglet privé fermé : on efface ce qu'il a pu laisser
            WebStorage.getInstance().deleteAllData()
        }
    }

    private fun load(tab: Tab, url: String) {
        val target = toLoadable(url)
        val headers = if (store.settings.optBoolean("sendGPC", true)) mapOf("Sec-GPC" to "1", "DNT" to "1") else emptyMap()
        tab.webView.loadUrl(target, headers)
    }

    /** gip://x → https://gip.internal/x */
    private fun toLoadable(url: String): String {
        if (url.startsWith("gip://")) {
            val rest = url.removePrefix("gip://").let { if (it.startsWith("newtab")) "home" + it.removePrefix("newtab") else it }
            return BASE + rest.ifEmpty { "home" }
        }
        return url
    }

    private fun isHomeUrl(u: String) = u.startsWith("gip://home") || u.startsWith("gip://newtab") || u.trimEnd('/') == BASE + "home" || u == BASE

    fun displayUrl(url: String): String {
        if (url.isEmpty() || isHomeUrl(url)) return ""
        if (url.startsWith(BASE)) {
            val u = Uri.parse(url)
            val page = u.path?.trim('/') ?: ""
            if (page == "error") return u.getQueryParameter("url") ?: url
            if (page == "search") u.getQueryParameter("q")?.let { return it }
            return "gip://" + url.removePrefix(BASE).trimEnd('/')
        }
        return url
    }

    private fun homepage() = store.settings.optString("homepage", "gip://home").ifEmpty { "gip://home" }

    fun resolveInput(input: String): String {
        val s = input.trim()
        if (s.isEmpty()) return homepage()
        if (Regex("^(gip|https?|file|about|data):", RegexOption.IGNORE_CASE).containsMatchIn(s)) return s
        if (Regex("^(localhost|\\d{1,3}(\\.\\d{1,3}){3})(:\\d+)?(/.*)?$", RegexOption.IGNORE_CASE).matches(s)) return "http://$s"
        if (!s.contains(' ') && Regex("^[^\\s/]+\\.[a-z]{2,}(:\\d+)?(/.*)?$", RegexOption.IGNORE_CASE).matches(s)) return "https://$s"
        return api.searchUrl(s)
    }

    private fun navigate(input: String) {
        hideSuggest()
        val t = current ?: return
        load(t, resolveInput(input))
        urlField.clearFocus(); hideKeyboard()
    }

    /* ------------------------------ Client web ------------------------------ */

    private fun serveAsset(uri: Uri): WebResourceResponse {
        val path = uri.path ?: "/"
        val asset = if (path.startsWith("/assets/")) "gip" + path
        else { val name = path.trim('/').substringBefore('/').ifEmpty { "home" }.let { if (it == "newtab") "home" else it }
            "gip/pages/" + (if (name in PAGES) name else "error") + ".html" }
        val mime = when (asset.substringAfterLast('.')) {
            "html" -> "text/html"; "css" -> "text/css"; "js" -> "text/javascript"; "svg" -> "image/svg+xml"; "png" -> "image/png"; "json" -> "application/json"; else -> "application/octet-stream"
        }
        return try {
            val headers = HashMap<String, String>()
            if (mime == "text/html") headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data: blob: https: http:; style-src 'self' 'unsafe-inline'; script-src 'self'; media-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'"
            headers["Cache-Control"] = "no-cache"
            WebResourceResponse(mime, "utf-8", 200, "OK", headers, assets.open(asset))
        } catch (e: Exception) {
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream("Introuvable".toByteArray()))
        }
    }

    private fun bump(key: String) {
        val s = store.session ?: return
        synchronized(store) { val st = s.data.optJSONObject("stats") ?: return; st.put(key, st.optInt(key) + 1) }
        store.saveSoon()
    }

    inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
            val uri = req.url
            if (uri.host == HOST) return serveAsset(uri)
            val tab = tabOf(view) ?: return null
            if (req.isForMainFrame) return null
            val host = uri.host ?: return null
            val kind = Shield.classify(host) ?: return null
            val s = store.settings
            if ((kind == "ad" && !s.optBoolean("blockAds", true)) || (kind == "tracker" && !s.optBoolean("blockTrackers", true))) return null
            if (Shield.siteOf(host) == Shield.siteOf(tab.topHost)) return null
            if (kind == "ad") tab.ads++ else tab.trackers++
            synchronized(tab.blockedHosts) { tab.blockedHosts.add(host) }
            bump("blockedTotal")
            ui.post { if (tab === current) updateShield(true) }
            return WebResourceResponse("text/plain", "utf-8", 204, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
        }

        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
            val uri = req.url
            val tab = tabOf(view)
            val url = uri.toString()
            when (uri.scheme?.lowercase()) {
                "gip" -> { view.loadUrl(toLoadable(url)); return true }
                "http", "https" -> {
                    if (uri.host == HOST) return tab != null && !tab.isInternal && req.isForMainFrame && tab.url.isNotEmpty() // une page web ne peut pas ouvrir gip://
                    if (!req.isForMainFrame) return false
                    val s = store.settings
                    if (uri.scheme == "http" && s.optBoolean("httpsOnly", true) && !Shield.isLocal(uri.host ?: "") && (uri.host ?: "") !in Shield.httpExceptions) {
                        tab?.let { it.upgrades++ }; bump("upgradedTotal")
                        view.loadUrl(url.replaceFirst("http://", "https://")); return true
                    }
                    if (s.optBoolean("stripTrackingParams", true)) Shield.cleanUrl(url)?.let { tab?.let { t -> t.params++ }; bump("paramsStripped"); view.loadUrl(it); return true }
                    return false
                }
                "about", "data", "blob", "javascript" -> return false
                else -> {
                    try {
                        val intent = if (url.startsWith("intent:")) Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply { addCategory(Intent.CATEGORY_BROWSABLE); component = null; selector = null }
                        else Intent(Intent.ACTION_VIEW, uri)
                        startActivity(intent)
                    } catch (e: Exception) {
                        if (url.startsWith("intent:")) Intent.parseUri(url, Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url")?.let { view.loadUrl(it) }
                            ?: toast("Aucune application pour ouvrir ce lien")
                        else toast("Aucune application pour ouvrir ce lien")
                    }
                    return true
                }
            }
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            val tab = tabOf(view) ?: return
            val host = Uri.parse(url).host ?: ""
            if (host != tab.topHost || !tab.loading) { tab.ads = 0; tab.trackers = 0; synchronized(tab.blockedHosts) { tab.blockedHosts.clear() } }
            tab.url = url; tab.topHost = host; tab.isInternal = host == HOST
            tab.loading = true; tab.favicon = favicon
            if (tab === current) { updateChrome(); progress.visibility = View.VISIBLE }
        }

        override fun onPageFinished(view: WebView, url: String) {
            val tab = tabOf(view) ?: return
            tab.loading = false
            if (tab === current) { updateChrome(); progress.animate().alpha(0f).setDuration(300).withEndAction { progress.visibility = View.INVISIBLE; progress.alpha = 1f }.start() }
            addHistory(tab)
            saveSession()
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
            val tab = tabOf(view) ?: return
            tab.url = url
            if (tab === current) updateChrome()
        }

        override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
            if (!req.isForMainFrame || req.url.host == HOST) return
            val code = when (err.errorCode) {
                ERROR_HOST_LOOKUP -> -105; ERROR_CONNECT -> -102; ERROR_TIMEOUT -> -118; ERROR_FAILED_SSL_HANDSHAKE -> -200
                ERROR_PROXY_AUTHENTICATION -> -111; ERROR_UNSAFE_RESOURCE -> -20; ERROR_BAD_URL -> -300; else -> -2
            }
            showError(view, code, err.description?.toString() ?: "", req.url.toString())
        }

        @SuppressLint("WebViewClientOnReceivedSslError")
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            showError(view, -201, "ERR_CERT_INVALID", error.url)
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            val tab = tabOf(view) ?: return true
            val url = tab.url
            if (tab === authView?.tag) { showLock(true); return true }
            val i = tabs.indexOf(tab)
            tabs.remove(tab); container.removeView(view); view.destroy()
            val nt = newTab(url, background = tab !== current)
            if (i >= 0) { tabs.remove(nt); tabs.add(i, nt) }
            toast("😵 L'onglet a planté — Gip l'a rechargé")
            return true
        }
    }

    private fun showError(view: WebView, code: Int, desc: String, url: String) {
        val q = "?code=$code&desc=" + Uri.encode(desc) + "&url=" + Uri.encode(url)
        view.loadUrl(BASE + "error" + q)
    }

    private fun addHistory(tab: Tab) {
        if (tab.isPrivate || !store.loggedIn || !store.settings.optBoolean("saveHistory", true)) return
        val url = tab.url
        if (url.isEmpty() || isHomeUrl(url) || url.startsWith(BASE + "error") || url.startsWith(BASE + "auth") || url.startsWith("about:")) return
        val shown = if (url.startsWith(BASE)) "gip://" + url.removePrefix(BASE).trimEnd('/') else url
        val title = tab.webView.title ?: shown
        bg.execute {
            store.update { d ->
                val h = d.getJSONArray("history")
                val last = h.optJSONObject(0)
                if (last != null && last.optString("url") == shown) { last.put("title", title).put("date", GipStore.now()) }
                else {
                    d.put("history", h.prepend(JSONObject().put("id", GipStore.uid(6)).put("url", shown).put("title", title).put("date", GipStore.now())))
                    if (d.getJSONArray("history").length() > 20000) d.getJSONArray("history").remove(20000)
                }
            }
        }
    }

    private fun saveSession() {
        if (!store.loggedIn || store.isGuest || authView != null) return
        val list = JSONArray(tabs.filter { !it.isPrivate && it.url.isNotEmpty() }.take(60).map { JSONObject().put("url", displayUrl(it.url).let { d -> if (it.url.startsWith(BASE)) (if (isHomeUrl(it.url)) "gip://home" else "gip://" + it.url.removePrefix(BASE).trimEnd('/')) else d }).put("title", it.title) })
        bg.execute { try { store.update { d -> d.put("lastSession", list) } } catch (_: Exception) {} }
    }

    /* ------------------------------ Chrome client ------------------------------ */

    inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, p: Int) {
            if (tabOf(view) === current) {
                progress.visibility = if (p < 100) View.VISIBLE else progress.visibility
                if (Build.VERSION.SDK_INT >= 24) progress.setProgress(p, true) else progress.progress = p
            }
        }
        override fun onReceivedTitle(view: WebView, title: String?) {
            val tab = tabOf(view) ?: return
            tab.title = title ?: ""
            if (!tab.isPrivate && store.loggedIn && !tab.isInternal) bg.execute { store.update { d -> d.getJSONArray("history").optJSONObject(0)?.let { if (it.optString("url") == tab.url) it.put("title", tab.title) } } }
        }
        override fun onReceivedIcon(view: WebView, icon: Bitmap?) { tabOf(view)?.favicon = icon }

        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            val opener = tabOf(view)
            val nt = newTab("", private = opener?.isPrivate == true, opener = opener)
            (resultMsg.obj as WebView.WebViewTransport).webView = nt.webView
            resultMsg.sendToTarget()
            return true
        }
        override fun onCloseWindow(window: WebView) { tabOf(window)?.let { closeTab(it) } }

        override fun onPermissionRequest(request: PermissionRequest) {
            ui.post {
                val origin = request.origin.toString().trimEnd('/')
                if (request.origin.host == HOST) { request.deny(); return@post }
                val needs = mutableListOf<String>(); val labels = mutableListOf<String>()
                for (r in request.resources) when (r) {
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> { needs.add(Manifest.permission.CAMERA); labels.add("votre caméra") }
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> { needs.add(Manifest.permission.RECORD_AUDIO); labels.add("votre micro") }
                    PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID -> labels.add("la lecture de contenus protégés")
                }
                askSite(origin, "media", labels.joinToString(" et ").ifEmpty { "un accès spécial" }) { allow ->
                    if (!allow) request.deny()
                    else runtimePermissions(needs) { ok -> if (ok) request.grant(request.resources) else request.deny() }
                }
            }
        }
        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            askSite(origin.trimEnd('/'), "geolocation", "connaître votre position") { allow ->
                if (!allow) callback.invoke(origin, false, false)
                else runtimePermissions(listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) { ok -> callback.invoke(origin, ok, false) }
            }
        }

        override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = cb
            return try { startActivityForResult(params.createIntent().apply { if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true) }, REQ_FILE); true }
            catch (e: Exception) { fileCallback = null; false }
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (customView != null) { callback.onCustomViewHidden(); return }
            customView = view; customCallback = callback
            val fs = findViewById<FrameLayout>(R.id.fullscreen)
            fs.addView(view, FrameLayout.LayoutParams(-1, -1)); fs.visibility = View.VISIBLE
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            root.requestApplyInsets()
        }
        override fun onHideCustomView() { exitFullscreen() }
    }

    private fun exitFullscreen() {
        val v = customView ?: return
        val fs = findViewById<FrameLayout>(R.id.fullscreen)
        fs.removeView(v); fs.visibility = View.GONE
        customView = null
        customCallback?.onCustomViewHidden(); customCallback = null
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = 0
        root.requestApplyInsets()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILE) {
            val result = if (resultCode == RESULT_OK && data != null) {
                data.clipData?.let { c -> Array(c.itemCount) { c.getItemAt(it).uri } } ?: data.data?.let { arrayOf(it) }
            } else null
            fileCallback?.onReceiveValue(result); fileCallback = null
        }
    }

    /* ------------------------------ Autorisations ------------------------------ */

    private fun askSite(origin: String, perm: String, what: String, cb: (Boolean) -> Unit) {
        val saved = store.settings.optJSONObject("sitePermissions")?.optJSONObject(origin)?.optString(perm)
        if (saved == "allow") return cb(true)
        if (saved == "deny") return cb(false)
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding((22 * dp).toInt(), (6 * dp).toInt(), (22 * dp).toInt(), 0) }
        val remember = CheckBox(this).apply { text = "Mémoriser pour ce site"; isChecked = current?.isPrivate != true; setTextColor(getColor(R.color.muted)) }
        box.addView(TextView(this).apply { text = "${Uri.parse(origin).host ?: origin} souhaite $what."; setTextColor(getColor(R.color.text)); textSize = 15f })
        box.addView(remember)
        var answered = false
        val answer = { allow: Boolean ->
            if (!answered) {
                answered = true
                if (remember.isChecked && store.loggedIn) bg.execute { store.update { d -> val sp = d.getJSONObject("settings").optJSONObject("sitePermissions") ?: JSONObject().also { d.getJSONObject("settings").put("sitePermissions", it) }
                    (sp.optJSONObject(origin) ?: JSONObject().also { sp.put(origin, it) }).put(perm, if (allow) "allow" else "deny") } }
                cb(allow)
            }
        }
        AlertDialog.Builder(this, R.style.Gip_Dialog).setTitle("Autorisation").setView(box)
            .setPositiveButton("Autoriser") { _, _ -> answer(true) }
            .setNegativeButton("Bloquer") { _, _ -> answer(false) }
            .setOnCancelListener { answer(false) }.show()
    }

    private fun runtimePermissions(perms: List<String>, cb: (Boolean) -> Unit) {
        val missing = perms.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) return cb(true)
        val code = ++permSeq
        permCallbacks[code] = cb
        requestPermissions(missing.toTypedArray(), code)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        permCallbacks.remove(requestCode)?.invoke(grantResults.isNotEmpty() && grantResults.any { it == PackageManager.PERMISSION_GRANTED })
    }

    /* ------------------------------ Pont JavaScript ------------------------------ */

    inner class Bridge(private val wv: WebView) {
        @JavascriptInterface
        fun call(method: String, argJson: String, id: Int) {
            val tab = tabOf(wv)
            // Seules les pages internes gip:// peuvent utiliser l'API
            val allowed = tab != null && tab.isInternal && (wv === authView || !method.startsWith("auth.")) && (wv !== authView || method.startsWith("auth."))
            bg.execute {
                val (ok, json) = if (!allowed) false to JSONObject.quote("Accès refusé") else try {
                    val arg = JSONTokener(argJson).nextValue()
                    true to toJson(api.call(method, if (arg == JSONObject.NULL) null else arg))
                } catch (e: Throwable) { false to JSONObject.quote(e.message ?: e.toString()) }
                ui.post { try { wv.evaluateJavascript("window.__gipResolve&&window.__gipResolve($id,$ok,$json)", null) } catch (_: Exception) {} }
            }
        }
    }

    private fun toJson(v: Any?): String = when (v) {
        null, JSONObject.NULL, Unit -> "null"
        is JSONObject, is JSONArray -> v.toString()
        is String -> JSONObject.quote(v)
        is Number, is Boolean -> v.toString()
        else -> JSONObject.quote(v.toString())
    }

    override fun emit(channel: String, payload: Any?) {
        val js = "window.__gipEmit&&window.__gipEmit(${JSONObject.quote(channel)},${toJson(payload)})"
        ui.post { for (t in tabs) if (t.isInternal) t.webView.evaluateJavascript(js, null) }
    }

    /* ------------------------------ Hôte : services natifs ------------------------------ */

    override fun versionName(): String = packageManager.getPackageInfo(packageName, 0).versionName ?: "2.0.0"

    override fun copyToClipboard(text: String, sensitive: Boolean) {
        ui.post {
            val cm = getSystemService(ClipboardManager::class.java)
            val clip = ClipData.newPlainText("Gip", text)
            if (sensitive && Build.VERSION.SDK_INT >= 33) clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
            cm.setPrimaryClip(clip)
            if (sensitive) ui.postDelayed({ try { if (cm.primaryClip?.getItemAt(0)?.text?.toString() == text) cm.clearPrimaryClip() } catch (_: Exception) {} }, 30000)
        }
    }

    override fun clearWebData(types: List<String>) {
        ui.post {
            if ("cookies" in types) { CookieManager.getInstance().removeAllCookies(null); CookieManager.getInstance().flush() }
            if ("storage" in types) WebStorage.getInstance().deleteAllData()
            if ("cache" in types) (current?.webView ?: WebView(this)).clearCache(true)
            if ("history" in types) tabs.forEach { it.webView.clearHistory() }
            if ("permissions" in types) GeolocationPermissions.getInstance().clearAll()
        }
    }

    override fun saveToDownloads(name: String, mime: String, bytes: ByteArray): Boolean = try {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name); put(MediaStore.Downloads.MIME_TYPE, mime.ifEmpty { "application/octet-stream" })
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Gip")
        }
        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)!!
        contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
        ui.post { toast("Enregistré dans Téléchargements/Gip") }
        true
    } catch (e: Exception) { ui.post { toast("Échec de l'enregistrement : ${e.message}") }; false }

    override fun openDownload(id: String): Boolean {
        val dm = getSystemService(DownloadManager::class.java)
        val uri = id.toLongOrNull()?.let { dm.getUriForDownloadedFile(it) } ?: return false
        return try {
            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, dm.getMimeTypeForDownloadedFile(id.toLong())).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)); true
        } catch (e: Exception) { false }
    }

    override fun onSettingsChanged() {
        ui.post {
            val block3p = store.settings.optBoolean("blockThirdPartyCookies", true)
            for (t in tabs) CookieManager.getInstance().setAcceptThirdPartyCookies(t.webView, !block3p)
            updateShield(false)
        }
    }

    /* ------------------------------ Téléchargements ------------------------------ */

    private fun download(url: String, ua: String?, cd: String?, mime: String?, private: Boolean) {
        if (url.startsWith("blob:") || url.startsWith("data:")) { toast("Ce type de téléchargement n'est pas pris en charge"); return }
        val name = URLUtil.guessFileName(url, cd, mime)
        try {
            val req = DownloadManager.Request(Uri.parse(url))
                .setMimeType(mime).setTitle(name).setDescription("Gip 2.0")
                .addRequestHeader("User-Agent", ua ?: "")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            CookieManager.getInstance().getCookie(url)?.let { req.addRequestHeader("Cookie", it) }
            val id = getSystemService(DownloadManager::class.java).enqueue(req)
            val rec = JSONObject().put("id", id.toString()).put("name", name).put("url", url).put("path", "Download/$name").put("total", 0).put("received", 0).put("state", "progressing").put("date", GipStore.now()).put("private", private)
            if (!private && store.loggedIn && !store.isGuest) bg.execute { store.update { d -> d.put("downloads", d.getJSONArray("downloads").prepend(rec)) } }
            emit("download:update", rec)
            showBanner("⬇ Téléchargement : $name")
        } catch (e: Exception) { toast("Téléchargement impossible : ${e.message}") }
    }

    private fun registerDownloads() {
        downloadReceiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                val id = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
                val dm = getSystemService(DownloadManager::class.java)
                dm.query(DownloadManager.Query().setFilterById(id))?.use { cur ->
                    if (!cur.moveToFirst()) return
                    val ok = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) == DownloadManager.STATUS_SUCCESSFUL
                    val total = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                    val title = cur.getString(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE)) ?: ""
                    var rec: JSONObject? = null
                    if (store.loggedIn) bg.execute {
                        store.update { d -> d.getJSONArray("downloads").findObj { it.optString("id") == id.toString() }?.let { it.put("state", if (ok) "completed" else "interrupted").put("total", total).put("received", total); rec = it } }
                        rec?.let { emit("download:update", it) }
                    }
                    if (ok) showBanner("✓ $title téléchargé — Ouvrir", 6000) { openDownload(id.toString()) } else toast("Échec du téléchargement : $title")
                }
            }
        }
        val f = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(downloadReceiver, f, RECEIVER_EXPORTED) else registerReceiver(downloadReceiver, f)
    }

    /* ------------------------------ Appui long ------------------------------ */

    private fun longPress(wv: WebView): Boolean {
        val r = wv.hitTestResult
        val extra = r.extra ?: return false
        val tab = tabOf(wv)
        val items = mutableListOf<Pair<String, () -> Unit>>()
        when (r.type) {
            WebView.HitTestResult.SRC_ANCHOR_TYPE, WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE -> {
                val link = if (r.type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) { val m = Handler(Looper.getMainLooper()).obtainMessage(); wv.requestFocusNodeHref(m); m.data.getString("url") ?: extra } else extra
                items += "Ouvrir dans un nouvel onglet" to { newTab(link, background = true, private = tab?.isPrivate == true, opener = tab); showBanner("Onglet ouvert en arrière-plan") }
                items += "Ouvrir dans un onglet privé" to { newTab(link, private = true) }
                items += "Copier l'adresse du lien" to { copyToClipboard(link, false); toast("Lien copié") }
                items += "Partager le lien" to { share(link) }
                if (r.type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) items += "Télécharger l'image" to { download(extra, wv.settings.userAgentString, null, null, tab?.isPrivate == true) }
            }
            WebView.HitTestResult.IMAGE_TYPE -> {
                items += "Ouvrir l'image dans un nouvel onglet" to { newTab(extra, background = true, opener = tab) }
                items += "Télécharger l'image" to { download(extra, wv.settings.userAgentString, null, null, tab?.isPrivate == true) }
                items += "Copier l'adresse de l'image" to { copyToClipboard(extra, false); toast("Adresse copiée") }
            }
            else -> return false
        }
        AlertDialog.Builder(this, R.style.Gip_Dialog).setTitle(extra.take(120)).setItems(items.map { it.first }.toTypedArray()) { _, w -> items[w].second() }.show()
        return true
    }

    private fun share(text: String) = startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "Partager"))

    /* ------------------------------ Barre d'outils ------------------------------ */

    private fun bindChrome() {
        findViewById<View>(R.id.back).setOnClickListener { current?.webView?.let { if (it.canGoBack()) it.goBack() } }
        findViewById<View>(R.id.forward).setOnClickListener { current?.webView?.let { if (it.canGoForward()) it.goForward() } }
        findViewById<View>(R.id.home).setOnClickListener { current?.let { load(it, homepage()) } }
        findViewById<View>(R.id.reload).setOnClickListener { current?.let { if (it.loading) it.webView.stopLoading() else it.webView.reload() } }
        findViewById<View>(R.id.tabsBtn).setOnClickListener { showTabs() }
        findViewById<View>(R.id.tabsBtn).setOnLongClickListener { newTab(homepage()); true }
        findViewById<View>(R.id.menu).setOnClickListener { showMenu(it) }
        findViewById<View>(R.id.shield).setOnClickListener { showShield() }
        siteIcon.setOnClickListener { showSiteInfo() }

        urlField.setOnFocusChangeListener { _, has ->
            findViewById<View>(R.id.omnibox).setBackgroundResource(if (has) R.drawable.field_bg_focus else R.drawable.field_bg)
            if (has) { current?.let { urlField.setText(displayUrl(it.url)) }; urlField.post { urlField.selectAll() } }
            else { hideSuggest(); current?.let { urlField.setText(displayUrl(it.url)) } }
        }
        urlField.setOnEditorActionListener { _, action, ev ->
            if (action == EditorInfo.IME_ACTION_GO || ev?.keyCode == KeyEvent.KEYCODE_ENTER) { navigate(urlField.text.toString()); true } else false
        }
        urlField.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) { if (urlField.hasFocus()) querySuggest(s.toString()) }
        })

        val findInput = findViewById<EditText>(R.id.findInput)
        val findCount = findViewById<TextView>(R.id.findCount)
        findInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) { current?.webView?.findAllAsync(s.toString()) }
        })
        findInput.setOnEditorActionListener { _, _, _ -> current?.webView?.findNext(true); true }
        findViewById<View>(R.id.findNext).setOnClickListener { current?.webView?.findNext(true) }
        findViewById<View>(R.id.findPrev).setOnClickListener { current?.webView?.findNext(false) }
        findViewById<View>(R.id.findClose).setOnClickListener { closeFind() }
        container.viewTreeObserver.addOnGlobalLayoutListener { }
        WebView.setWebContentsDebuggingEnabled(false)
        findCount.text = "0/0"
    }

    private fun openFind() {
        val t = current ?: return
        findbar.visibility = View.VISIBLE
        findbar.alpha = 0f; findbar.animate().alpha(1f).setDuration(200).start()
        val input = findViewById<EditText>(R.id.findInput)
        input.requestFocus()
        getSystemService(InputMethodManager::class.java).showSoftInput(input, 0)
        t.webView.setFindListener { active, count, _ -> findViewById<TextView>(R.id.findCount).text = if (count == 0) "0/0" else "${active + 1}/$count" }
    }

    private fun closeFind() {
        if (findbar.visibility != View.VISIBLE) return
        findbar.visibility = View.GONE
        current?.webView?.clearMatches()
        hideKeyboard()
    }

    private fun hideKeyboard() = getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(root.windowToken, 0)

    fun updateChrome() {
        val t = current ?: return
        if (!urlField.hasFocus()) urlField.setText(displayUrl(t.url))
        findViewById<ImageButton>(R.id.reload).setImageResource(if (t.loading) R.drawable.ic_stop else R.drawable.ic_reload)
        findViewById<View>(R.id.back).alpha = if (t.webView.canGoBack()) 1f else 0.35f
        findViewById<View>(R.id.forward).alpha = if (t.webView.canGoForward()) 1f else 0.35f
        val (icon, color) = when {
            t.isInternal -> R.drawable.ic_sparkle to getColor(R.color.accent)
            t.url.startsWith("https:") -> R.drawable.ic_lock to getColor(R.color.ok)
            t.url.startsWith("http:") -> R.drawable.ic_warn to Color.parseColor("#FFB547")
            t.isPrivate -> R.drawable.ic_mask to Color.parseColor("#B15CFF")
            else -> R.drawable.ic_globe to getColor(R.color.muted)
        }
        siteIcon.setImageResource(if (t.isPrivate && t.isInternal) R.drawable.ic_mask else icon)
        siteIcon.imageTintList = android.content.res.ColorStateList.valueOf(if (t.isPrivate && t.isInternal) Color.parseColor("#B15CFF") else color)
        urlField.hint = if (t.isPrivate) "Navigation privée — rien n'est enregistré" else "Rechercher avec Gip ou saisir une adresse"
        updateShield(false)
    }

    private var lastShieldCount = 0
    private fun updateShield(animate: Boolean) {
        val t = current ?: return
        val on = store.settings.optBoolean("blockAds", true) || store.settings.optBoolean("blockTrackers", true)
        findViewById<View>(R.id.shield).visibility = if (t.isInternal) View.GONE else View.VISIBLE
        shieldIcon.setImageResource(if (on) R.drawable.ic_shield else R.drawable.ic_shield_off)
        shieldIcon.imageTintList = android.content.res.ColorStateList.valueOf(if (on) getColor(R.color.ok) else getColor(R.color.muted))
        val n = t.ads + t.trackers
        shieldCount.text = if (n > 99) "99+" else n.toString()
        shieldCount.visibility = if (n > 0 && on) View.VISIBLE else View.GONE
        if (animate && n > lastShieldCount) {
            shieldCount.animate().scaleX(1.4f).scaleY(1.4f).setDuration(120).withEndAction { shieldCount.animate().scaleX(1f).scaleY(1f).setDuration(160).start() }.start()
        }
        lastShieldCount = n
    }

    private fun updateTabsCount() {
        tabsCount.text = if (tabs.size > 99) ":D" else tabs.size.toString()
    }

    private fun bumpTabs() {
        updateTabsCount()
        tabsCount.animate().scaleX(1.35f).scaleY(1.35f).setDuration(140).withEndAction { tabsCount.animate().scaleX(1f).scaleY(1f).setDuration(200).start() }.start()
    }

    /* ------------------------------ Suggestions ------------------------------ */

    private var sugReq = 0
    private fun querySuggest(q: String) {
        val req = ++sugReq
        if (q.isBlank() || !store.loggedIn) { hideSuggest(); return }
        val private = current?.isPrivate == true
        bg.execute {
            val ql = q.lowercase()
            val local = mutableListOf<Pair<String, String>>()
            try {
                store.data.optJSONArray("bookmarks")?.objects()?.filter { (it.optString("title") + it.optString("url")).lowercase().contains(ql) }?.take(3)?.forEach { local += "★ " + it.optString("title") to it.optString("url") }
                store.data.optJSONArray("history")?.objects()?.asSequence()?.filter { (it.optString("title") + it.optString("url")).lowercase().contains(ql) }?.distinctBy { it.optString("url") }?.take(3)?.forEach { local += "🕘 " + it.optString("title") to it.optString("url") }
            } catch (_: Exception) {}
            val remote = if (private) emptyList() else GipSearch.suggest(q).map { "🔍 $it" to api.searchUrl(it) }
            ui.post {
                if (req != sugReq || !urlField.hasFocus()) return@post
                val items = (local.distinctBy { it.second } + remote).take(8)
                if (items.isEmpty()) { hideSuggest(); return@post }
                val popup = suggestPopup ?: ListPopupWindow(this).also { p ->
                    p.anchorView = findViewById(R.id.omnibox)
                    p.setBackgroundDrawable(GradientDrawable().apply { setColor(Color.parseColor("#161A34")); cornerRadius = 18 * dp })
                    p.isModal = false
                    p.inputMethodMode = ListPopupWindow.INPUT_METHOD_NEEDED
                    suggestPopup = p
                }
                popup.setAdapter(object : ArrayAdapter<Pair<String, String>>(this, android.R.layout.simple_list_item_2, android.R.id.text1, items) {
                    override fun getView(pos: Int, convertView: View?, parent: ViewGroup): View {
                        val v = super.getView(pos, convertView, parent)
                        v.findViewById<TextView>(android.R.id.text1).apply { text = items[pos].first; setTextColor(getColor(R.color.text)); maxLines = 1; textSize = 15f }
                        v.findViewById<TextView>(android.R.id.text2).apply { text = displayUrl(items[pos].second).takeIf { !items[pos].first.startsWith("🔍") } ?: ""; setTextColor(getColor(R.color.accent2)); maxLines = 1; textSize = 12f }
                        return v
                    }
                })
                popup.setOnItemClickListener { _, _, pos, _ -> hideSuggest(); current?.let { load(it, items[pos].second) }; urlField.clearFocus(); hideKeyboard() }
                popup.show()
            }
        }
    }

    private fun hideSuggest() { suggestPopup?.dismiss() }

    /* ------------------------------ Dialogues ------------------------------ */

    private fun card(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding((20 * dp).toInt(), (18 * dp).toInt(), (20 * dp).toInt(), (10 * dp).toInt())
    }

    private fun label(text: String, size: Float = 14f, color: Int = getColor(R.color.text), bold: Boolean = false) = TextView(this).apply {
        this.text = text; textSize = size; setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD
        setPadding(0, (4 * dp).toInt(), 0, (4 * dp).toInt())
    }

    private fun showShield() {
        val t = current ?: return
        val s = store.settings
        val box = card()
        val on = s.optBoolean("blockAds", true) || s.optBoolean("blockTrackers", true)
        box.addView(label("🛡️ Bouclier Gip ${if (on) "actif" else "désactivé"}", 19f, bold = true))
        box.addView(label(Uri.parse(t.url).host ?: "", 13f, getColor(R.color.muted)))
        val grid = GridLayout(this).apply { columnCount = 2 }
        for ((n, l) in listOf(t.ads to "Publicités bloquées", t.trackers to "Traqueurs bloqués", t.upgrades to "Passages en HTTPS", t.params to "Liens nettoyés")) {
            val cell = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundResource(R.drawable.card_bg); setPadding((14 * dp).toInt(), (10 * dp).toInt(), (14 * dp).toInt(), (10 * dp).toInt()) }
            val num = label("0", 24f, bold = true)
            cell.addView(num); cell.addView(label(l, 11f, getColor(R.color.muted)))
            grid.addView(cell, GridLayout.LayoutParams().apply { width = 0; columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f); setMargins(4, 8, 4, 8) })
            android.animation.ValueAnimator.ofInt(0, n).apply { duration = 700; addUpdateListener { num.text = it.animatedValue.toString() } }.start()
        }
        box.addView(grid)
        if (store.loggedIn) for ((k, l) in listOf("blockAds" to "Bloquer les publicités", "blockTrackers" to "Bloquer les traqueurs", "blockThirdPartyCookies" to "Bloquer les cookies tiers", "httpsOnly" to "HTTPS partout", "fingerprintProtection" to "Anti-empreinte numérique", "stripTrackingParams" to "Nettoyer les liens")) {
            box.addView(Switch(this).apply { text = l; isChecked = s.optBoolean(k, true); setTextColor(getColor(R.color.text)); setPadding(0, (6 * dp).toInt(), 0, (6 * dp).toInt())
                setOnCheckedChangeListener { _, v -> bg.execute { api.setSettings(JSONObject().put(k, v)) } } })
        }
        val hosts = synchronized(t.blockedHosts) { t.blockedHosts.toList() }
        if (hosts.isNotEmpty()) box.addView(label("Bloqués sur cette page :\n" + hosts.take(20).joinToString("\n") { "⛔ $it" }, 12f, getColor(R.color.muted)))
        val scroll = ScrollView(this).apply { addView(box) }
        AlertDialog.Builder(this, R.style.Gip_Dialog).setView(scroll)
            .setPositiveButton("Fermer", null)
            .setNeutralButton("Tableau de bord") { _, _ -> openInternal("gip://privacy") }
            .setNegativeButton("Recharger") { _, _ -> t.webView.reload() }.show()
    }

    private fun showSiteInfo() {
        val t = current ?: return
        val u = Uri.parse(t.url)
        val (title, msg) = when {
            t.isInternal -> "Gip 2.0" to "✨ Page interne de Gip. Vos données restent chiffrées sur cet appareil."
            t.url.startsWith("https:") -> (u.host ?: "") to "🔒 La connexion est sécurisée (HTTPS). Les informations échangées sont chiffrées."
            t.url.startsWith("http:") -> (u.host ?: "") to "⚠️ Connexion non sécurisée. Ne saisissez aucune information sensible."
            else -> t.url to "Page locale."
        }
        val b = AlertDialog.Builder(this, R.style.Gip_Dialog).setTitle(title).setMessage(msg + if (t.isPrivate) "\n\n🕶 Onglet privé : rien n'est enregistré dans l'historique." else "").setPositiveButton("OK", null)
        if (!t.isInternal && u.host != null) b.setNeutralButton("Effacer les données du site") { _, _ ->
            val origin = "${u.scheme}://${u.host}"
            WebStorage.getInstance().deleteOrigin(origin)
            CookieManager.getInstance().getCookie(t.url)?.split(";")?.forEach { c -> val name = c.substringBefore('=').trim()
                CookieManager.getInstance().setCookie(t.url, "$name=; Max-Age=0; Path=/") }
            CookieManager.getInstance().flush()
            toast("Données du site effacées"); t.webView.reload()
        }
        b.show()
    }

    private fun openInternal(url: String) {
        val target = toLoadable(url)
        tabs.firstOrNull { it.url.trimEnd('/').startsWith(target.trimEnd('/')) && !it.isPrivate }?.let { select(it); return }
        val t = current
        if (t != null && isHomeUrl(t.url)) load(t, url) else newTab(url, opener = t)
    }

    private fun showMenu(anchor: View) {
        val t = current
        val bookmarked = t != null && store.loggedIn && store.data.optJSONArray("bookmarks")?.findObj { toLoadable(it.optString("url")) == t.url || it.optString("url") == t.url } != null
        val pm = PopupMenu(this, anchor, Gravity.END)
        val m = pm.menu
        m.add(0, 1, 0, "＋  Nouvel onglet")
        m.add(0, 2, 1, "🕶  Nouvel onglet privé")
        if (t != null && !isHomeUrl(t.url)) m.add(0, 3, 2, if (bookmarked) "★  Retirer des favoris" else "☆  Ajouter aux favoris")
        if (t != null && !t.isInternal) { m.add(0, 4, 3, "↗  Partager"); m.add(0, 5, 4, "🔎  Rechercher dans la page")
            m.add(0, 6, 5, "🖥  Version pour ordinateur").isCheckable = true; m.findItem(6).isChecked = t.desktop }
        val svc = m.addSubMenu(0, 7, 6, "✦  Services Gip")
        listOf("🔍  Gip Search" to "gip://search", "✉️  Gip Mail" to "gip://mail", "📝  Gip Notes" to "gip://notes", "🔑  Coffre-fort" to "gip://vault", "☁️  Gip Drive" to "gip://drive", "📅  Gip Agenda" to "gip://agenda")
            .forEachIndexed { i, (l, u) -> svc.add(1, 100 + i, i, l).setOnMenuItemClickListener { openInternal(u); true } }
        m.add(0, 8, 7, "🕘  Historique"); m.add(0, 9, 8, "⬇  Téléchargements"); m.add(0, 10, 9, "★  Favoris")
        m.add(0, 11, 10, "🛡  Confidentialité"); m.add(0, 12, 11, "⚙  Paramètres"); m.add(0, 13, 12, "👤  Mon compte")
        m.add(0, 14, 13, "↺  Rouvrir l'onglet fermé"); m.add(0, 15, 14, "ℹ  À propos de Gip 2.0")
        m.add(0, 16, 15, "🔒  Verrouiller Gip"); m.add(0, 17, 16, "⏻  Quitter")
        pm.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> newTab(homepage())
                2 -> { newTab(homepage(), private = true); showBanner("🕶 Onglet privé : rien ne sera enregistré") }
                3 -> t?.let { tab -> toggleBookmark(tab, bookmarked) }
                4 -> t?.let { share(it.url) }
                5 -> openFind()
                6 -> t?.let { tab -> tab.desktop = !tab.desktop
                    tab.webView.settings.userAgentString = if (tab.desktop) "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" else null
                    if (!tab.desktop) tab.webView.settings.userAgentString = tab.webView.settings.userAgentString.replace("; wv", "").replace(Regex(" Version/\\d+\\.\\d+"), "")
                    tab.webView.reload() }
                8 -> openInternal("gip://history"); 9 -> openInternal("gip://downloads"); 10 -> openInternal("gip://bookmarks")
                11 -> openInternal("gip://privacy"); 12 -> openInternal("gip://settings"); 13 -> openInternal("gip://account")
                14 -> reopenClosed(); 15 -> openInternal("gip://about")
                16 -> lock(); 17 -> { store.flush(); finishAndRemoveTask() }
                else -> return@setOnMenuItemClickListener false
            }
            true
        }
        pm.show()
    }

    private fun toggleBookmark(tab: Tab, bookmarked: Boolean) {
        val shown = if (tab.url.startsWith(BASE)) "gip://" + tab.url.removePrefix(BASE).trimEnd('/') else tab.url
        bg.execute {
            store.update { d -> val b = d.getJSONArray("bookmarks")
                if (bookmarked) d.put("bookmarks", b.filterObj { it.optString("url") != shown && toLoadable(it.optString("url")) != tab.url })
                else b.put(JSONObject().put("id", GipStore.uid(6)).put("url", shown).put("title", tab.title.ifEmpty { shown }).put("date", GipStore.now())) }
            emit("bookmarks:changed", store.data.getJSONArray("bookmarks"))
        }
        showBanner(if (bookmarked) "Retiré des favoris" else "★ Ajouté aux favoris")
    }

    private fun reopenClosed() {
        val a = store.data.optJSONArray("closedTabs")
        val first = a?.optJSONObject(0)
        if (first == null) { showBanner("Aucun onglet récemment fermé"); return }
        store.update { d -> d.put("closedTabs", JSONArray(d.getJSONArray("closedTabs").objects().drop(1))) }
        newTab(first.optString("url"))
    }

    /** Sélecteur d'onglets plein écran, animé. */
    private fun showTabs() {
        hideSuggest()
        val d = Dialog(this, android.R.style.Theme_Material_NoActionBar_Fullscreen)
        val outer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.parseColor("#F00B0D17")); setPadding((14 * dp).toInt(), (40 * dp).toInt(), (14 * dp).toInt(), (20 * dp).toInt()) }
        val head = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        head.addView(label("Onglets · ${tabs.size}", 22f, bold = true), LinearLayout.LayoutParams(0, -2, 1f))
        fun pill(text: String, onClick: () -> Unit) = TextView(this).apply {
            this.text = text; setTextColor(Color.WHITE); textSize = 14f; typeface = Typeface.DEFAULT_BOLD
            setBackgroundResource(R.drawable.btn_bg); setPadding((14 * dp).toInt(), (9 * dp).toInt(), (14 * dp).toInt(), (9 * dp).toInt())
            setOnClickListener { onClick() }
        }
        head.addView(pill("＋ Onglet") { d.dismiss(); newTab(homepage()) })
        head.addView(Space(this), LinearLayout.LayoutParams((8 * dp).toInt(), 1))
        head.addView(pill("🕶 Privé") { d.dismiss(); newTab(homepage(), private = true) })
        outer.addView(head)
        val grid = GridLayout(this).apply { columnCount = 2; setPadding(0, (14 * dp).toInt(), 0, 0) }
        tabs.forEachIndexed { i, t ->
            val c = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setBackgroundResource(if (t === current) R.drawable.card_bg_active else R.drawable.card_bg)
                setPadding((14 * dp).toInt(), (12 * dp).toInt(), (10 * dp).toInt(), (14 * dp).toInt())
                elevation = 4 * dp
            }
            val top = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
            val fav = ImageView(this)
            if (t.favicon != null) fav.setImageBitmap(t.favicon) else { fav.setImageResource(if (t.isPrivate) R.drawable.ic_mask else if (t.isInternal) R.drawable.ic_sparkle else R.drawable.ic_globe) }
            top.addView(fav, LinearLayout.LayoutParams((18 * dp).toInt(), (18 * dp).toInt()))
            top.addView(Space(this), LinearLayout.LayoutParams(0, 1, 1f))
            top.addView(ImageButton(this).apply { setImageResource(R.drawable.ic_x); background = null; setPadding(8, 8, 8, 8); scaleType = ImageView.ScaleType.FIT_CENTER
                setOnClickListener {
                    c.animate().alpha(0f).scaleX(0.8f).scaleY(0.8f).setDuration(180).withEndAction { closeTab(t); d.dismiss(); if (tabs.size > 1) showTabs() }.start()
                } }, LinearLayout.LayoutParams((32 * dp).toInt(), (32 * dp).toInt()))
            c.addView(top)
            c.addView(label((if (t.isPrivate) "🕶 " else "") + t.title.ifEmpty { if (isHomeUrl(t.url)) "Nouvel onglet" else displayUrl(t.url) }, 14f, bold = true).apply { maxLines = 2 })
            c.addView(label(displayUrl(t.url).ifEmpty { "gip://home" }, 11f, getColor(R.color.muted)).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
            c.setOnClickListener { select(t); d.dismiss() }
            grid.addView(c, GridLayout.LayoutParams().apply { width = 0; height = (130 * dp).toInt(); columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f); setMargins((5 * dp).toInt(), (5 * dp).toInt(), (5 * dp).toInt(), (5 * dp).toInt()) })
            c.alpha = 0f; c.scaleX = 0.85f; c.scaleY = 0.85f; c.translationY = 30 * dp
            c.animate().alpha(1f).scaleX(1f).scaleY(1f).translationY(0f).setStartDelay(i * 35L).setDuration(380).setInterpolator(android.view.animation.OvershootInterpolator(1.2f)).start()
        }
        outer.addView(ScrollView(this).apply { addView(grid) }, LinearLayout.LayoutParams(-1, 0, 1f))
        d.setContentView(outer)
        d.show()
    }

    /* ------------------------------ Bannière ------------------------------ */

    private fun showBanner(msg: String, duration: Long = 2600, action: (() -> Unit)? = null) {
        ui.post {
            banner.text = msg
            banner.setOnClickListener(if (action != null) View.OnClickListener { banner.visibility = View.GONE; action() } else null)
            banner.visibility = View.VISIBLE
            banner.alpha = 0f; banner.translationY = 40 * dp; banner.scaleX = 0.9f; banner.scaleY = 0.9f
            banner.animate().alpha(1f).translationY(0f).scaleX(1f).scaleY(1f).setDuration(380).setInterpolator(android.view.animation.OvershootInterpolator(1.3f)).start()
            banner.removeCallbacks(hideBanner)
            banner.postDelayed(hideBanner, duration)
        }
    }

    private val hideBanner = Runnable { banner.animate().alpha(0f).translationY(20 * dp).setDuration(250).withEndAction { banner.visibility = View.GONE }.start() }

    private fun toast(msg: String) = ui.post { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }

    /* ------------------------------ Retour ------------------------------ */

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            customView != null -> exitFullscreen()
            findbar.visibility == View.VISIBLE -> closeFind()
            urlField.hasFocus() -> { urlField.clearFocus(); hideKeyboard() }
            authView != null -> moveTaskToBack(true)
            current?.webView?.canGoBack() == true -> current!!.webView.goBack()
            current?.opener != null && tabs.size > 1 -> closeTab(current!!)
            else -> moveTaskToBack(true)
        }
    }
}
