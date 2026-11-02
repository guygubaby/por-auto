plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.por.auto.input"
    compileSdk = 34
    buildFeatures { buildConfig = true }
    defaultConfig {
        applicationId = "com.por.auto.input"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }
    val signingPath = providers.environmentVariable("POR_INPUT_KEYSTORE").orNull
    if (signingPath != null) signingConfigs.create("porInput") {
        storeFile = file(signingPath)
        storePassword = providers.environmentVariable("POR_INPUT_STORE_PASSWORD").get()
        keyAlias = "por-input"
        keyPassword = providers.environmentVariable("POR_INPUT_KEY_PASSWORD").get()
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            if (signingPath != null) signingConfig = signingConfigs.getByName("porInput")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies { testImplementation(libs.junit) }
