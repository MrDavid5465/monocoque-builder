//! Finding a host on the LAN without typing its address.
//!
//! Hosts advertise themselves over mDNS; clients browse for them. A manual
//! address in Settings (`AppSettings::client_host`) skips all of this, for
//! networks where multicast doesn't get through.

use std::net::Ipv4Addr;
use std::time::Duration;

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};

/// mDNS service type. Service names are capped at 15 characters, so the
/// app's full name doesn't fit.
const SERVICE_TYPE: &str = "_mb-telemetry._tcp.local.";

/// Starts advertising this machine as a relay host. Keep the returned
/// daemon alive for as long as the advertisement should stand; dropping it
/// withdraws it.
pub fn advertise(port: u16) -> Option<ServiceDaemon> {
    let daemon = ServiceDaemon::new()
        .map_err(|e| eprintln!("relay: mDNS unavailable, clients must use a manual address: {e}"))
        .ok()?;
    let name = super::host_name();
    let properties = [("protocol", super::PROTOCOL_VERSION.to_string())];
    let info = ServiceInfo::new(
        SERVICE_TYPE,
        &name,
        &format!("{name}.local."),
        "",
        port,
        &properties[..],
    )
    .ok()?
    // Fills the addresses in from this machine's interfaces, and keeps them
    // current if they change.
    .enable_addr_auto();
    daemon
        .register(info)
        .map_err(|e| eprintln!("relay: couldn't advertise on mDNS: {e}"))
        .ok()?;
    eprintln!("relay: advertising {name} on the LAN");
    Some(daemon)
}

/// Browses for a host for up to `timeout`, returning `address:port` of the
/// first one found that isn't this machine.
pub async fn find(timeout: Duration) -> Option<String> {
    let daemon = ServiceDaemon::new().ok()?;
    let events = daemon.browse(SERVICE_TYPE).ok()?;
    let own_name = super::host_name();
    let found = tokio::time::timeout(timeout, async {
        while let Ok(event) = events.recv_async().await {
            let ServiceEvent::ServiceResolved(service) = event else {
                continue;
            };
            // A machine can be both: a host that's been switched to client
            // mode still advertises until restarted.
            if service
                .host
                .trim_end_matches('.')
                .trim_end_matches(".local")
                == own_name
            {
                continue;
            }
            let address: Option<Ipv4Addr> = service.get_addresses_v4().into_iter().next();
            if let Some(address) = address {
                return Some(format!("{address}:{}", service.get_port()));
            }
        }
        None
    })
    .await
    .ok()
    .flatten();
    let _ = daemon.shutdown();
    found
}
