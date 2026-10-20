use std::{
    collections::BTreeMap,
    sync::{Mutex, OnceLock},
};

type Cache = BTreeMap<(String, String, String), Result<String, String>>;
static VALUES: OnceLock<Mutex<Cache>> = OnceLock::new();
static HTTP_ENDPOINTS: OnceLock<Mutex<BTreeMap<String, String>>> = OnceLock::new();

// Only saved local configurations and freshly supplied secrets establish a binding.
pub fn bind_http(id: &str, endpoint: &str) {
    if uuid::Uuid::parse_str(id).is_ok() {
        if let Ok(mut bindings) = HTTP_ENDPOINTS.get_or_init(Default::default).lock() {
            bindings.entry(id.into()).or_insert_with(|| endpoint.into());
        }
    }
}

pub fn check_http(id: &str, endpoint: &str) -> Result<(), String> {
    let bindings = HTTP_ENDPOINTS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "鉴权地址绑定不可用")?;
    if bindings.get(id).map(String::as_str) != Some(endpoint) {
        return Err("请求地址已改变或鉴权未保存，请重新填写鉴权值后保存或测试".into());
    }
    Ok(())
}

pub fn read_once(
    service: &str,
    id: &str,
    endpoint: &str,
    read: impl FnOnce() -> Result<String, String>,
) -> Result<String, String> {
    VALUES
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "凭据缓存不可用")?
        .entry((service.into(), id.into(), endpoint.into()))
        .or_insert_with(read)
        .clone()
}

pub fn forget(service: &str, id: &str) {
    if let Ok(mut cache) = VALUES.get_or_init(Default::default).lock() {
        cache.retain(|(owner, key, _), _| owner != service || key != id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_reads_and_denials_are_cached_without_crossing_services_or_endpoints() {
        let id = uuid::Uuid::new_v4().to_string();
        let count = std::cell::Cell::new(0);
        for _ in 0..3 {
            assert_eq!(
                read_once("vision", &id, "https://example.com/v1", || {
                    count.set(count.get() + 1);
                    Ok("test-only".into())
                })
                .unwrap(),
                "test-only"
            );
        }
        assert_eq!(count.get(), 1);
        forget("vision", &id);
        for _ in 0..3 {
            assert!(read_once("vision", &id, "https://example.com/v1", || {
                count.set(count.get() + 1);
                Err("denied".into())
            })
            .is_err());
        }
        assert_eq!(count.get(), 2);
        assert_eq!(
            read_once("http", &id, "https://example.com/v1", || Ok(
                "other-service".into()
            ))
            .unwrap(),
            "other-service"
        );
        assert_eq!(
            read_once("vision", &id, "https://other.example.com/v1", || Ok(
                "other-endpoint".into()
            ))
            .unwrap(),
            "other-endpoint"
        );
        forget("vision", &id);
        forget("http", &id);
    }
}
