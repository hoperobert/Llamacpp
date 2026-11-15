// The notifications package asks for the entitlement that remote (push)
// notifications need. This app only posts notifications from the phone itself,
// which needs no entitlement, and asking for one the app's signing profile
// does not carry fails the build. So the request is taken back out.

const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = (config) =>
  withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
