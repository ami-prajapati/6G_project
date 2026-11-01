// Content for the "Research papers, 6G references & datasets" panel.
// Edit this file to add or remove entries - no component changes needed.
// NOTE: external links were collected from public sources and not re-checked automatically;
// publishers sometimes move or rename files, so open each link to confirm it still works.

export const PAPERS = [
  {
    title: 'Integrated 6G TN and NTN Localization: Survey',
    org: 'Chalmers Research',
    kind: 'Survey (PDF)',
    url: 'https://research.chalmers.se/publication/546711/file/546711_Fulltext.pdf',
    note: 'How 6G combines terrestrial (TN) and non-terrestrial (NTN) positioning with GNSS / LEO-PNT, and the hybrid set-ups needed for very high accuracy.',
  },
  {
    title: '6G Satellite (NTN) White Paper',
    org: 'MediaTek',
    kind: 'White paper (PDF)',
    url: 'https://www.mediatek.com/hubfs/MediaTek_WhitePaper-6G-Satellite_EN0523F.pdf',
    note: '6G and non-terrestrial network convergence: spectrum, 3GPP standards and device hardware architecture.',
  },
  {
    title: '6G-SENTINEL: Positioning White Paper',
    org: 'Fraunhofer IIS',
    kind: 'White paper (PDF)',
    url: 'https://www.iis.fraunhofer.de/content/dam/iis/en/doc/ks/bb/6g-sentinel-white-paper-positioning.pdf',
    note: 'Integrated Sensing and Communication (ISAC) and the move from stand-alone GNSS to network-verified positioning.',
  },
  {
    title: 'Integration of Communication and Navigation Technologies Toward LEO-Enabled 6G Networks: A Survey',
    org: 'Space: Science & Technology',
    kind: 'Survey (PDF)',
    url: 'https://spj.science.org/doi/pdf/10.34133/space.0092',
    note: 'LEO integrated communication and navigation (LEO-ICAN) and 3-D space-air-ground network topologies.',
  },
  {
    title: 'Integration of Communication, Positioning and Navigation Technologies in 6G Mobile Networks: A Survey',
    org: 'ResearchGate',
    kind: 'Survey',
    url: 'https://www.researchgate.net/publication/414472628_Integration_of_Communication_Positioning_and_Navigation_Technologies_in_6G_Mobile_Networks_A_Survey',
    note: 'Survey of joint communication, positioning and navigation in 6G. May require a ResearchGate login to download.',
  },
  {
    title: 'Integration of Communication and Navigation Technologies Toward LEO-Enabled 6G Networks (ResearchGate page)',
    org: 'ResearchGate',
    kind: 'Survey',
    url: 'https://www.researchgate.net/publication/374746798_Integration_of_Communication_and_Navigation_Technologies_Towards_LEO-Enabled_6G_Networks_A_Survey',
    note: 'Author page for the Space: Science & Technology survey above.',
  },
  {
    title: 'Architecture Working Group White Paper (v1.3)',
    org: 'SNS JU / 6G-IA',
    kind: 'White paper (PDF)',
    url: 'https://smart-networks.europa.eu/wp-content/uploads/2025/06/archwg-whitepaper-v1.3-final-23may_clean.pdf',
    note: 'European 6G system-architecture white paper from the Smart Networks and Services Joint Undertaking.',
  },
  {
    title: '6G Technologies - Technology Working Group Report',
    org: 'Next G Alliance',
    kind: 'Report (PDF)',
    url: 'https://nextgalliance.org/wp-content/uploads/dlm_uploads/2022/07/TWG-report-6G-technologies.pdf',
    note: 'Overview of candidate 6G technologies from the North American Next G Alliance.',
  },
  {
    title: 'arXiv preprint 2607.26846',
    org: 'arXiv',
    kind: 'Preprint (PDF)',
    url: 'https://arxiv.org/pdf/2607.26846',
    note: 'Title not verified - open the link to read the abstract before citing it.',
  },
]

export const LINKS = [
  { title: 'ITU-R IMT-2030 (6G) programme', org: 'ITU', url: 'https://www.itu.int/en/ITU-R/study-groups/rsg5/rwp5d/imt-2030/Pages/default.aspx', note: 'The official international framework and timeline for 6G (IMT-2030).' },
  { title: '3GPP - standards for 5G-Advanced and 6G', org: '3GPP', url: 'https://www.3gpp.org', note: 'Releases, work items and specifications. Search for NTN, TR 38.821 and Release 17-20.' },
  { title: 'Hexa-X 6G flagship project', org: 'EU', url: 'https://hexa-x.eu', note: 'European 6G research project: vision, use cases and deliverables.' },
  { title: 'Smart Networks and Services Joint Undertaking', org: 'EU', url: 'https://smart-networks.europa.eu', note: 'EU programme funding 6G research, with architecture and spectrum white papers.' },
  { title: 'Next G Alliance', org: 'ATIS', url: 'https://nextgalliance.org', note: 'North American 6G roadmap and technology reports.' },
  { title: 'Ericsson - 6G', org: 'Ericsson', url: 'https://www.ericsson.com/en/6g', note: 'Industry view on 6G research and technology.' },
  { title: 'Nokia - 6G', org: 'Nokia', url: 'https://www.nokia.com/6g/', note: 'Industry view on 6G research and technology.' },
]

// Files served from /downloads (copied from the 6G_Datasets folder).
export const ZIP_ALL = { file: '6G_Datasets_All.zip', size: '3.8 MB', note: 'Every file below plus the helper scripts and checksums' }

export const DATASETS = [
  { file: 'navic_constellation.tle', name: 'NavIC (IRNSS)', size: '1 KB', real: true, note: '7 satellites - GEO / inclined GSO' },
  { file: 'gps_constellation.tle', name: 'GPS operational', size: '5 KB', real: true, note: '32 satellites' },
  { file: 'galileo_constellation.tle', name: 'Galileo', size: '5 KB', real: true, note: '32 satellites' },
  { file: 'glonass_constellation.tle', name: 'GLONASS', size: '4 KB', real: true, note: '27 satellites' },
  { file: 'beidou_constellation.tle', name: 'BeiDou', size: '9 KB', real: true, note: '53 satellites' },
  { file: 'sbas_gagan.tle', name: 'SBAS incl. GAGAN', size: '3 KB', real: true, note: '21 satellites' },
  { file: 'leo_6g_oneweb.tle', name: 'OneWeb (LEO)', size: '107 KB', real: true, note: '651 satellites - used for the 6G NTN link' },
  { file: 'leo_6g_starlink.tle', name: 'Starlink (LEO)', size: '1.8 MB', real: true, note: '10,652 satellites' },
  { file: 'leo_6g_iridium.tle', name: 'Iridium NEXT (LEO)', size: '13 KB', real: true, note: '80 satellites' },
  { file: 'leo_6g_kuiper.tle', name: 'Kuiper (LEO)', size: '65 KB', real: true, note: '391 satellites' },
  { file: 'ionosphere_tec.dat', name: 'Ionosphere TEC + L1 delay', size: '6.2 MB', real: false, note: '12 Indian sites, 7 days, 60 s steps' },
  { file: 'user_trajectory_profiles.csv', name: 'Receiver trajectory profiles', size: '8.4 MB', real: false, note: '24 profiles from pedestrian to high-speed rail, 1 Hz' },
]

// Fresh data from the original providers (needs internet).
export const DATA_SOURCES = [
  { title: 'CelesTrak - satellite element sets (TLE)', url: 'https://celestrak.org/NORAD/elements/', note: 'Free, regularly updated orbital data for every constellation.' },
  { title: 'CelesTrak: NavIC / IRNSS', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=irnss&FORMAT=tle', note: 'Direct TLE text' },
  { title: 'CelesTrak: GPS operational', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle', note: 'Direct TLE text' },
  { title: 'CelesTrak: Galileo', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=galileo&FORMAT=tle', note: 'Direct TLE text' },
  { title: 'CelesTrak: OneWeb', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=oneweb&FORMAT=tle', note: 'Direct TLE text' },
  { title: 'CelesTrak: Starlink', url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle', note: 'Direct TLE text' },
  { title: 'Space-Track.org', url: 'https://www.space-track.org', note: 'Official US space-object catalogue (free account required).' },
  { title: 'NASA CDDIS GNSS data', url: 'https://cddis.nasa.gov', note: 'GNSS observations and products, including ionosphere (IONEX) maps.' },
  { title: 'International GNSS Service (IGS)', url: 'https://igs.org', note: 'Precise orbits, clocks and ionosphere products.' },
]
