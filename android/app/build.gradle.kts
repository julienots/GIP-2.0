plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Les pages gip:// sont partagées avec la version bureau (src/renderer/pages).
// Elles sont copiées et adaptées pour Android à chaque build.
val gipShared = rootProject.file("../src")
val gipGenerated = layout.buildDirectory.dir("generated/gipAssets")

val syncGipPages by tasks.registering {
    inputs.dir(gipShared.resolve("renderer/pages"))
    inputs.file(gipShared.resolve("main/blocklist.js"))
    outputs.dir(gipGenerated)
    doLast {
        val out = gipGenerated.get().asFile.resolve("gip")
        out.deleteRecursively()
        val pages = gipShared.resolve("renderer/pages")
        pages.walkTopDown().filter { it.isFile }.forEach { f ->
            val rel = f.relativeTo(pages).invariantSeparatorsPath
            val dest = if (rel.startsWith("assets/")) out.resolve(rel) else out.resolve("pages/$rel")
            dest.parentFile.mkdirs()
            if (f.extension in listOf("html", "css", "js")) {
                var t = f.readText().replace("gip://assets/", "/assets/")
                if (f.extension == "html") {
                    t = t.replace(
                        "<script src=\"/assets/icons.js\"></script>",
                        "<script src=\"/assets/android/shim.js\"></script>\n  <script src=\"/assets/icons.js\"></script>"
                    ).replace("</head>", "  <link rel=\"stylesheet\" href=\"/assets/android/mobile.css\">\n</head>")
                        .replace("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
                            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">")
                }
                dest.writeText(t)
            } else f.copyTo(dest, overwrite = true)
        }
        gipShared.resolve("main/blocklist.js").copyTo(out.resolve("blocklist.js"), overwrite = true)
    }
}

android {
    namespace = "app.gip.browser"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.gip.browser"
        minSdk = 29
        targetSdk = 35
        versionCode = 2
        versionName = "2.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    sourceSets["main"].assets.srcDir(gipGenerated)

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

tasks.named("preBuild") { dependsOn(syncGipPages) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
