//! API key storage. Production uses the OS keychain; tests/fake use memory.

use std::sync::Mutex;

use super::LlmIpcError;

pub const KEYRING_SERVICE: &str = "cloud.snowfire.supernotes";
pub const KEYRING_ACCOUNT: &str = "llm_api_key";

pub trait SecretStore: Send + Sync {
    fn set_api_key(&self, key: &str) -> Result<(), LlmIpcError>;
    fn get_api_key(&self) -> Result<Option<String>, LlmIpcError>;
    fn clear_api_key(&self) -> Result<(), LlmIpcError>;
}

fn persist_failed() -> LlmIpcError {
    LlmIpcError::new(
        "request_failed",
        "Could not persist the API key in the OS keychain. Test would send no Authorization header.",
    )
}

#[derive(Default)]
pub struct MemorySecretStore {
    key: Mutex<Option<String>>,
}

impl SecretStore for MemorySecretStore {
    fn set_api_key(&self, key: &str) -> Result<(), LlmIpcError> {
        *self.key.lock().expect("secret store poisoned") = Some(key.to_string());
        Ok(())
    }

    fn get_api_key(&self) -> Result<Option<String>, LlmIpcError> {
        Ok(self.key.lock().expect("secret store poisoned").clone())
    }

    fn clear_api_key(&self) -> Result<(), LlmIpcError> {
        *self.key.lock().expect("secret store poisoned") = None;
        Ok(())
    }
}

pub struct KeyringSecretStore {
    service: String,
    account: String,
}

impl KeyringSecretStore {
    // ponytail: Linux uses keyutils (session keyring). Upgrade to
    // linux-native-sync-persistent + crypto-rust if keys must survive reboot.
    pub fn production() -> Self {
        Self {
            service: KEYRING_SERVICE.to_string(),
            account: KEYRING_ACCOUNT.to_string(),
        }
    }

    #[cfg(test)]
    pub fn for_test(service: impl Into<String>, account: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            account: account.into(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, LlmIpcError> {
        // Fresh Entry every call. The mock fallback is Entry-only: a second
        // Entry::new cannot see a password set on the first. Platform stores
        // (apple-native / windows-native / linux-native) persist across this.
        keyring::Entry::new(&self.service, &self.account).map_err(map_keyring_err)
    }
}

impl SecretStore for KeyringSecretStore {
    fn set_api_key(&self, key: &str) -> Result<(), LlmIpcError> {
        self.entry()?.set_password(key).map_err(map_keyring_err)?;
        // Read back through a new Entry so a mock/no-backend set cannot look saved.
        match self.get_api_key()? {
            Some(got) if got == key => Ok(()),
            Some(_) | None => Err(persist_failed()),
        }
    }

    fn get_api_key(&self) -> Result<Option<String>, LlmIpcError> {
        match self.entry()?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(map_keyring_err(err)),
        }
    }

    fn clear_api_key(&self) -> Result<(), LlmIpcError> {
        match self.entry()?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(map_keyring_err(err)),
        }
    }
}

fn map_keyring_err(err: keyring::Error) -> LlmIpcError {
    // Never include the secret; keyring's Display is platform text only.
    LlmIpcError::new(
        "request_failed",
        format!("Could not access the OS keychain ({err})."),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_store_sets_and_clears() {
        let store = MemorySecretStore::default();
        assert_eq!(store.get_api_key().unwrap(), None);
        store.set_api_key("sk-test").unwrap();
        assert_eq!(store.get_api_key().unwrap().as_deref(), Some("sk-test"));
        store.clear_api_key().unwrap();
        assert_eq!(store.get_api_key().unwrap(), None);
    }

    fn unique_test_store() -> KeyringSecretStore {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        KeyringSecretStore::for_test(
            "cloud.snowfire.supernotes.test",
            format!("llm_api_key_{nanos}"),
        )
    }

    #[test]
    fn keyring_store_set_get_clear_across_fresh_entries() {
        let store = unique_test_store();
        assert_eq!(store.get_api_key().unwrap(), None);
        store.set_api_key("sk-test-key").unwrap();
        assert_eq!(store.get_api_key().unwrap().as_deref(), Some("sk-test-key"));
        // A brand-new handle must see the same secret (real backend, not mock).
        let again = KeyringSecretStore {
            service: store.service.clone(),
            account: store.account.clone(),
        };
        assert_eq!(again.get_api_key().unwrap().as_deref(), Some("sk-test-key"));
        store.clear_api_key().unwrap();
        assert_eq!(store.get_api_key().unwrap(), None);
        assert_eq!(again.get_api_key().unwrap(), None);
    }
}
