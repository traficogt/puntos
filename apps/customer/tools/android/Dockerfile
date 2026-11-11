# Reusable toolchain only: app sources and signing credentials are runtime mounts.
FROM eclipse-temurin:17-jdk-jammy@sha256:057a0daec60e87c96571bf5c9c7792065bcb19e804d584cd37d4144038a35717
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git unzip zip xz-utils openssl perl python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
      https://nodejs.org/dist/v22.23.5/node-v22.23.5-linux-x64.tar.xz -o /tmp/node.tar.xz \
    && printf '%s  %s\n' 'cdeb8670a0c81f51b4dc4ac61919f9b1ad917b304bf8221eb939570663d240f8' /tmp/node.tar.xz | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && test "$(node --version)" = v22.23.5
# Google's published SHA-256: https://developer.android.com/studio#command-line-tools-only
RUN curl --fail --location --retry 3 --proto '=https' --tlsv1.2 \
      https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip -o /tmp/android-tools.zip \
    && printf '%s  %s\n' '4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583' /tmp/android-tools.zip | sha256sum -c - \
    && mkdir -p /opt/android-tools \
    && unzip -q /tmp/android-tools.zip -d /opt/android-tools \
    && mv /opt/android-tools/cmdline-tools /opt/android-tools/latest \
    && rm /tmp/android-tools.zip \
    && /opt/android-tools/latest/bin/sdkmanager --sdk_root=/opt/android-tools --version
ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    GRADLE_USER_HOME=/cache/gradle \
    npm_config_cache=/cache/npm \
    PF_ANDROID_ARTIFACTS_DIR=/artifacts \
    EXPO_PUBLIC_API_ORIGIN=https://app.puntosfieles.com \
    EXPO_NO_TELEMETRY=1 \
    CI=true
COPY --chmod=755 entrypoint.sh /usr/local/bin/pf-android-build
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/pf-android-build"]
