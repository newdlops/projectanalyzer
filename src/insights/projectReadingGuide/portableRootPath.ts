/**
 * Project Reading Guide compatibility boundary for shared portable paths.
 * Internal scope modules retain this feature-local import while the reusable
 * implementation stays dependency-neutral under shared.
 */

export {
  createPortableProjectPathNormalizer,
  type PortableProjectPath,
  type PortableProjectPathNormalizer
} from "../../shared/portableProjectPath";
