UPDATE public.simulation_event_templates SET
  summary = 'Federal and local officials are struggling to process a sustained migration wave at the southwest border. Shelter systems are beyond capacity, forcing emergency transportation and legal triage decisions.',
  dateline = 'El Paso —',
  body = $body$
Federal and local authorities across Texas and Arizona say intake operations are now running around the clock as arrivals continue to outpace available beds, case workers, and transport buses. Mayors in border counties report families sleeping in temporary intake tents while nonprofit shelters rotate volunteers from church networks and legal aid groups to keep lines moving.

State emergency managers told governors that weather and cartel route shifts are concentrating crossings in fewer sectors, creating crowding risks at checkpoints and processing centers. Customs officials say most arrivals are being screened and released with future court dates, a process critics call too slow and too fragile when daily totals stay elevated for multiple weeks.

> "We are not seeing a single-night spike, we are seeing a structural surge that requires federal surge staffing and immediate shelter reimbursement." — Elena Duarte, Texas Border Emergency Coordinator

White House aides say a package of temporary processing officers and FEMA support is being drafted, but local leaders warn that every day without added capacity deepens school absences, hospital strain, and political pressure on both parties heading into budget talks.
$body$
WHERE template_key = 'news_border_surge';

UPDATE public.simulation_event_templates SET
  summary = 'A deadly shooting at a state capitol has left lawmakers and staff shaken as investigators reconstruct the timeline. Security reviews are underway while the legislature debates whether to pause session.',
  dateline = 'Harrisburg —',
  body = $body$
Three people were killed and several others wounded after gunfire erupted near a committee corridor during an active legislative day, according to state police and capitol security officials. Witnesses described panic in hallways as alarms sounded and members were rushed into secure offices while tactical teams cleared floors one by one.

Investigators said the suspect entered through a public screening line shortly before noon and moved toward a hearing room where firearms policy testimony had drawn unusually high turnout. Authorities have not released a final motive, but digital evidence and recovered notes are now central to the case, with federal analysts assisting on forensic review.

> "The immediate priority is victim support and evidence integrity, but we also need a full independent audit of access control and threat screening failures." — Col. Marissa Kent, State Police Superintendent

Legislative leaders from both parties pledged to resume essential votes within days, yet staff unions are demanding upgraded perimeter protections, more trained officers, and a public timeline for implementing security recommendations before normal hearings restart.
$body$
WHERE template_key = 'news_capital_shooting';

UPDATE public.simulation_event_templates SET
  summary = 'A federal injunction has abruptly halted medication abortion access across three states, triggering emergency legal and health system responses. Providers warn patients in rural regions face immediate care gaps.',
  dateline = 'Washington —',
  body = $body$
Reproductive health clinics in three states began canceling appointments overnight after a federal judge issued a temporary injunction blocking distribution pathways for medication abortion pending appeal. Health systems said hotlines were flooded within hours by patients seeking alternatives, travel support, and legal guidance on rapidly changing rules.

State attorneys general backing the ruling argued current federal standards exceed statutory authority, while opponents called the order a direct threat to emergency care, especially for patients facing pregnancy complications in counties with no nearby surgical provider. Hospital administrators said transfer protocols are being rewritten daily as clinicians weigh legal exposure against medical urgency.

> "When policy shifts this fast, patients with the fewest resources absorb the risk first, and delay can become a medical crisis." — Dr. Naomi Pierce, Mid-Atlantic Reproductive Health Coalition

The Justice Department filed notice of appeal and requested a stay, but legal analysts expect a fast-moving circuit fight that could push conflicting standards onto providers for weeks, deepening regional inequity and further polarizing an already volatile national debate.
$body$
WHERE template_key = 'news_abortion_emergency';

UPDATE public.simulation_event_templates SET
  summary = 'A nationwide nurses strike has disrupted care at major hospital systems and increased emergency wait times. Negotiators remain far apart on safe staffing guarantees and retention funding.',
  dateline = 'Chicago —',
  body = $body$
Hospitals in more than a dozen states are operating contingency plans after union nurses walked out over staffing ratios, mandatory overtime, and burnout-related turnover. Administrators said trauma and emergency services remain open, but elective procedures and some specialty clinics are being postponed as temporary staffing contracts fail to cover demand.

Union leaders argue that wage increases alone will not stabilize care unless contracts include enforceable bedside staffing floors by unit type. Hospital executives counter that rigid ratio rules could force ward closures in regions already facing nursing shortages, and they are pushing for phased benchmarks tied to recruitment pipelines.

> "Patients notice the gap immediately when one nurse is covering too many unstable cases, and that is the line our members refuse to cross anymore." — Tasha Rollins, National Federation of Nurses bargaining chair

Federal mediators have joined talks, though both sides describe progress as limited. Public health officials warn that if no framework emerges within days, pediatric and long-term care spillover could spread disruptions beyond the original strike footprint.
$body$
WHERE template_key = 'news_healthcare_strike';

UPDATE public.simulation_event_templates SET
  summary = 'Large immigration enforcement raids at agricultural worksites have led to hundreds of detentions and renewed conflict over family separation concerns. Community groups and DHS now face dueling legal claims.',
  dateline = 'Fresno —',
  body = $body$
Pre-dawn immigration operations across the Central Valley targeted multiple packing facilities and labor camps, resulting in hundreds of detentions and immediate production slowdowns at peak harvest windows. School districts reported sharp absentee spikes as families sought legal counsel, childcare support, and information about detained relatives transferred to distant processing centers.

DHS officials said those detained were selected through case files tied to outstanding removal orders and labor exploitation investigations. Civil rights attorneys countered that several workers appear to have been swept up despite active status reviews, and they are preparing emergency filings to challenge access restrictions for legal visits and family notification.

> "Our concern is not only who was detained, but whether due process standards were followed in the first twelve hours when families had no reliable information." — Reverend Luis Calderon, Valley Sanctuary Network

Agribusiness leaders warned that prolonged labor disruption could raise produce prices nationally within weeks, while state officials urged federal agencies to publish detainee rosters and transfer locations to reduce panic in farmworker communities already under severe financial stress.
$body$
WHERE template_key = 'news_immigration_raid';

UPDATE public.simulation_event_templates SET
  summary = 'A coordinated cyberattack on utility software has triggered rolling outages across the Southeast during high heat conditions. Officials are balancing grid restoration with concerns about secondary malware persistence.',
  dateline = 'Atlanta —',
  body = $body$
Millions of residents across Georgia and the Carolinas faced intermittent power loss after attackers crippled a regional utility management vendor used by several electric cooperatives. Grid operators shifted to manual controls and rotating blackouts to protect substations, while hospitals and water systems activated backup generators under emergency protocols.

Cybersecurity teams from CISA and private incident firms said forensic indicators suggest a ransomware affiliate gained access weeks earlier through compromised vendor credentials. Engineers now fear dormant payloads may still exist in billing and dispatch environments, complicating restoration because each system segment must be scanned before reconnecting to avoid reinfection.

> "Restoring quickly matters, but restoring blindly can trigger a second collapse if adversary tooling is still embedded in control workflows." — Priya Sethi, former DOE cyber response director

Governors requested federal emergency declarations as heat indexes climbed above seasonal norms. Lawmakers in both parties are calling hearings on utility supply-chain security, with pressure mounting for mandatory cyber resilience standards for critical infrastructure vendors.
$body$
WHERE template_key = 'news_grid_cyberattack';

UPDATE public.simulation_event_templates SET
  summary = 'Eviction filings are accelerating in major coastal cities as rent burdens rise and temporary supports fade. Local officials are debating stopgap assistance while courts warn of growing backlogs.',
  dateline = 'Los Angeles —',
  body = $body$
Housing courts in several coastal metros reported steep increases in eviction filings this month, with legal aid offices describing an unprecedented queue of tenants facing hearings within days of receiving notices. Advocates say many households entered the year already spending more than half their income on rent and now have no cushion for medical bills or job interruptions.

City officials acknowledge emergency rental funds are nearly exhausted and that nonprofit mediation programs cannot keep up with demand. Landlord groups argue prolonged payment uncertainty is driving small property owners to sell units or defer repairs, further tightening supply in neighborhoods where low-income families have few alternatives.

> "The court calendar is moving faster than support systems, and families are losing housing before they even understand their options." — Janice Morrow, Director of Harbor Legal Housing Aid

Several councils are considering temporary right-to-counsel expansion and targeted arrears grants, but budget staff warn those plans may require reallocations from transit and public safety reserves, setting up difficult tradeoffs as election-year pressure intensifies.
$body$
WHERE template_key = 'news_housing_evictions';

UPDATE public.simulation_event_templates SET
  summary = 'Federal agents have seized an exceptionally large fentanyl shipment at a major port, renewing scrutiny of trafficking routes and inspection capacity. Public health agencies warn regional overdose risk remains acute.',
  dateline = 'Long Beach —',
  body = $body$
Customs and DEA officials announced the seizure of a multi-ton narcotics shipment hidden in industrial cargo containers bound for inland distribution hubs. Investigators believe the load was intended for several states and could have generated millions of counterfeit pills, intensifying concern among local health departments preparing for summer overdose spikes.

Law enforcement sources said the bust followed a months-long intelligence operation tracking logistics brokers and shell import firms tied to prior seizures. While officials called the action a major disruption, analysts cautioned that trafficking groups often diversify routes quickly, shifting volume to rail corridors and smaller ports when major gateways receive heightened attention.

> "One seizure of this scale saves lives, but sustained pressure requires inspection staffing, data sharing, and treatment funding moving in parallel." — Daniel Cho, Acting Administrator, Pacific Counter-Narcotics Task Force

Members of Congress from both parties are demanding classified briefings on port screening technology and interagency coordination, while state governors push for additional naloxone allocations and cross-state overdose surveillance to blunt downstream impacts.
$body$
WHERE template_key = 'news_opioid_shipment';

UPDATE public.simulation_event_templates SET
  summary = 'An attack near a diplomatic district has left American civilians missing and triggered a high-priority hostage response. U.S. agencies are coordinating with partners amid competing claims of responsibility.',
  dateline = 'Amman —',
  body = $body$
A vehicle bomb detonated near a diplomatic quarter before armed men opened fire on nearby security posts, killing at least a dozen people and leaving several Americans unaccounted for, according to local authorities. The U.S. Embassy activated emergency protocols and instructed nonessential personnel to shelter as regional governments tightened checkpoints.

Intelligence officials say responsibility claims from multiple militia channels are still being vetted, with analysts warning that copycat groups may be exploiting confusion to elevate their profile. Host nation forces have launched a citywide search, but negotiators note that early public messaging can harden captor demands and complicate backchannel contact.

> "In the first twenty-four hours, discipline is everything: verify identities, preserve communication lanes, and avoid statements that narrow diplomatic room." — Amina Rahal, former UN hostage mediation advisor

The State Department crisis cell is coordinating with Pentagon planners on contingency options while family liaison teams contact relatives. Markets in the region fell as investors assessed escalation risk and the possibility of retaliatory action against suspected command nodes.
$body$
WHERE template_key = 'news_hostage_crisis';

UPDATE public.simulation_event_templates SET
  summary = 'Sustained naval maneuvers in the Taiwan Strait have heightened fears of miscalculation and supply-chain disruption. U.S. and allied officials are weighing deterrence signaling against escalation risks.',
  dateline = 'Taipei —',
  body = $body$
Taiwan defense officials reported another day of extended patrols by Chinese naval and coast guard vessels near key transit lanes, describing the pattern as more coordinated and persistent than prior demonstrations. Commercial shippers have begun rerouting selected cargoes, and insurers are reviewing risk premiums tied to any interruption near semiconductor export corridors.

Washington said regional force posture changes are intended to maintain open sea lanes and reassure allies rather than provoke confrontation, though military planners privately acknowledge operational distance between rival vessels has narrowed in recent encounters. Diplomatic channels remain active but fragile, with each side accusing the other of destabilizing maneuvers.

> "The danger is not only intentional escalation; the immediate risk is a tactical incident that political systems then struggle to de-escalate quickly." — Rear Adm. (Ret.) Colin Mercer, Pacific Security Forum

Taiwanese officials urged restraint while accelerating civil defense drills and contingency planning for ports and communications infrastructure. Economic ministries across Asia are preparing emergency coordination calls if shipping delays deepen into broader market volatility.
$body$
WHERE template_key = 'news_taiwan_strait';

UPDATE public.simulation_event_templates SET
  summary = 'Front-line fighting in Europe has intensified after ceasefire talks collapsed, straining allied ammunition stocks and humanitarian corridors. Leaders face pressure to balance deterrence goals with domestic fatigue.',
  dateline = 'Brussels —',
  body = $body$
Military officials in eastern Europe reported heavier artillery exchanges and renewed drone strikes along multiple sectors after a short-lived truce attempt failed overnight. Civilian authorities said new displacement flows are moving toward western transit hubs, where shelters and medical charities are already operating near seasonal limits.

NATO governments remain publicly aligned on support, but internal debates over ammunition replenishment timelines and industrial production capacity have grown sharper. Defense planners warn that without faster procurement and predictable financing, allies could face difficult tradeoffs between immediate battlefield needs and homeland readiness requirements.

> "Unity remains strong in principle, but logistics and politics move at different speeds, and that gap is now visible on the ground." — Petra Vogel, senior analyst at the European Defense Observatory

Energy markets ticked upward on fears of infrastructure strikes, while finance ministers prepared emergency consultations on reconstruction lending and refugee support. Diplomats said another ceasefire window may emerge, yet confidence remains low unless both sides see enforceable monitoring terms.
$body$
WHERE template_key = 'news_europe_front';

UPDATE public.simulation_event_templates SET
  summary = 'Coup authorities in the Sahel have tightened control over strategic transport corridors tied to uranium exports, raising alarm in energy and security circles. Regional blocs are divided over sanctions and intervention options.',
  dateline = 'Niamey —',
  body = $body$
Leaders of the military junta announced new security zones around key mining and rail corridors, effectively consolidating control over routes linked to uranium exports used by overseas reactor markets. Border checkpoints and telecom restrictions were expanded as opposition figures reported detentions and limited access to independent media.

ECOWAS officials are debating a response package that ranges from financial sanctions to a standby force mandate, but member states remain split on costs and political risk. Western governments have evacuated nonessential staff while attempting to preserve limited technical contacts to prevent accidental clashes near airfields and logistics depots.

> "Resource chokepoints give junta leaders leverage quickly, but prolonged instability can fracture local economies and invite proxy competition." — Idris Mane, Sahel Governance Institute

Utilities and commodity traders in Europe are monitoring contract exposure as insurers reassess country risk. Humanitarian agencies warn that if trade routes remain disrupted, food imports and medical supply chains could deteriorate before the rainy season ends.
$body$
WHERE template_key = 'news_sahel_coup';

UPDATE public.simulation_event_templates SET
  summary = 'A collision between patrol vessels in contested Arctic waters has escalated diplomatic tensions and renewed concerns over military build-up in newly accessible routes. Both governments accuse the other of unsafe maneuvering.',
  dateline = 'Reykjavik —',
  body = $body$
Two government patrol ships collided during overlapping operations in disputed Arctic waters, prompting emergency communications and mutual accusations of reckless navigation. Both crews reported minor injuries, and each capital has lodged formal protests while releasing selective video clips to support competing versions of the incident.

Security analysts say thinning ice and expanding seasonal access are increasing operational density in areas once navigable only for brief windows. That shift is driving more frequent contact between coast guard and military platforms, especially near resource survey zones and emerging shipping lanes linking Atlantic and Pacific trade.

> "The Arctic is no longer a low-traffic buffer; it is becoming a contested operating environment where procedural mistakes can trigger strategic consequences." — Lt. Gen. (Ret.) Solveig Arnesen, Nordic Maritime Defense Council

Diplomats are pushing for a technical incident review mechanism, but talks are slowed by disputes over jurisdiction and surveillance rights. Energy firms and insurers now expect higher operating costs as governments harden patrol rules and expand infrastructure on ice-free ports.
$body$
WHERE template_key = 'news_arctic_clash';

UPDATE public.simulation_event_templates SET
  summary = 'A transatlantic counterterrorism operation has disrupted an alleged multi-country attack network targeting aviation and civic sites. Authorities are now racing to assess possible linked cells and copycat threats.',
  dateline = 'London —',
  body = $body$
Security services in Europe and North America announced coordinated arrests tied to an alleged extremist network that investigators say was preparing synchronized attacks against transport hubs and public events. Raids recovered encrypted devices, precursor materials, and route maps that prompted immediate increases in airport and rail security posture.

Officials cautioned that evidence review is ongoing and that some planned actions may have been aspirational rather than operational. Still, intelligence agencies have raised alert levels while analysts examine communication records for signs of additional facilitators, financiers, or online handlers outside the original arrest footprint.

> "Disrupting one operational cell is significant, but the strategic task is mapping the enabling ecosystem before replacement nodes emerge." — Karen Osei, Deputy Director, Atlantic Counterterror Center

Homeland Security and congressional leaders are set for classified briefings as governments weigh further watchlist and screening measures. Civil liberties groups urged transparency on surveillance authorities, warning that emergency powers adopted in haste often outlast the immediate threat.
$body$
WHERE template_key = 'news_terror_plot';

UPDATE public.simulation_event_templates SET
  summary = 'A humanitarian ship carrying food and medical aid has been blocked from entering a conflict-zone port, intensifying famine warnings. Diplomats are seeking a temporary maritime corridor amid competing security claims.',
  dateline = 'Nicosia —',
  body = $body$
A chartered aid vessel loaded with grain, antibiotics, and water purification supplies was turned back from a war-zone port after naval authorities cited an expanded exclusion zone. Relief agencies say the cargo was intended for districts where malnutrition rates have climbed sharply and clinic inventories are expected to run out within days.

Belligerent forces accused one another of exploiting aid convoys for political leverage, while UN officials said all documentation had been submitted under existing inspection protocols. Maritime insurers warned that prolonged uncertainty could deter commercial carriers from accepting relief charters even when security guarantees are offered.

> "Every denied docking window translates into preventable deaths, especially for children already in acute nutrition crisis." — Dr. Samira Haddad, Emergency Nutrition Coordinator, Global Relief Alliance

European and Gulf diplomats are discussing a monitored access arrangement that would pair naval escorts with neutral cargo verification. Humanitarian groups say any agreement must be durable enough to support weekly deliveries, not one-off symbolic shipments.
$body$
WHERE template_key = 'news_humanitarian_ship';

UPDATE public.simulation_event_templates SET
  summary = 'NATO leaders are publicly clashing over defense spending timelines as security pressures rise across multiple theaters. The dispute is testing alliance cohesion ahead of critical force-planning decisions.',
  dateline = 'Brussels —',
  body = $body$
An emergency NATO summit ended with sharp disagreements over burden-sharing after several member states missed previously announced defense spending targets. Officials from frontline countries warned that delayed modernization and munitions procurement could weaken deterrence credibility at a moment of sustained regional instability.

Larger economies argued they are contributing through logistics, intelligence, and industrial production expansion, while critics said headline percentages remain the clearest accountability metric. Diplomats worked overnight on compromise language that links spending trajectories to concrete capability milestones rather than a single deadline.

> "Alliance credibility depends on visible capability, not just communiques, and publics need proof that commitments are real and measurable." — Ingrid Maes, former NATO policy planning director

Markets reacted modestly, but defense contractors and finance ministries are watching for revised procurement schedules that could shift jobs and budgets across member states. The Secretary General called for a follow-on ministers meeting within thirty days to lock in verifiable national plans.
$body$
WHERE template_key = 'news_nato_spending';

UPDATE public.simulation_event_templates SET
  summary = 'Congressional negotiators are assembling a border package that pairs enforcement money with processing reforms, but ideological divisions remain deep. Leadership is under pressure to show progress before recess.',
  dateline = 'Washington —',
  body = $body$
Bipartisan negotiators met behind closed doors to draft a border framework that would combine short-term personnel funding with asylum court expansion and faster screening standards. Staff familiar with the talks said the proposal is designed to reduce processing bottlenecks while giving both parties policy wins they can defend to their base voters.

Hardline factions on both sides are threatening to sink any compromise they view as politically lopsided. Conservatives want mandatory detention triggers and stricter parole limits, while progressives are demanding stronger humanitarian safeguards, legal representation access, and constraints on family detention practices.

> "There is a narrow lane for a deal, but only if leadership treats operational fixes and legal protections as linked, not competing priorities." — Rep. Mallory Finch, member of the House bipartisan border working group

Appropriators warn that without near-term agreement, agencies will continue emergency transfers that strain other domestic programs. Senate leaders say floor time is available, but only if committee principals can produce legislative text with enforceable implementation timelines.
$body$
WHERE template_key = 'news_border_surge_congress';

UPDATE public.simulation_event_templates SET
  summary = 'Demonstrators in border counties are blocking key transport routes to demand immigration system changes and faster federal response. Officials are trying to manage safety while preventing broader logistics disruption.',
  dateline = 'Tucson —',
  body = $body$
Hundreds of demonstrators gathered near highway checkpoints and county administration sites to protest what organizers called a broken federal response to prolonged migration pressure. Traffic delays stretched for miles as state troopers diverted freight and commuter routes, and local officials warned that food and medical deliveries could be affected if blockades continue.

Organizers said the protests include residents frustrated by shelter overflow as well as immigrant rights groups objecting to emergency detention practices. County leaders requested additional logistics support and crowd management resources, emphasizing that public safety plans must avoid escalating tensions with families already under stress.

> "People are demonstrating because they feel ignored by every level of government, and that frustration is now visible on roads and in public services." — Sheriff Dana Wilcox, Pima County

Governors from neighboring states urged calm while pressing Washington for a coordinated operations plan. Federal mediators have offered to facilitate meetings between protest leaders, mayors, and agency officials to prevent further shutdowns of critical corridors.
$body$
WHERE template_key = 'news_border_surge_protests';

UPDATE public.simulation_event_templates SET
  summary = 'Investigators say recovered writings from the capitol shooting suspect referenced pending gun legislation and online grievance networks. The documents are intensifying political confrontation over motive and policy response.',
  dateline = 'Harrisburg —',
  body = $body$
State investigators confirmed that writings linked to the suspected capitol shooter include references to specific committee hearings and online channels focused on anti-government conspiracy narratives. Officials said forensic teams are authenticating digital files and tracing whether any outside actors helped plan logistics or amplify threats before the attack.

Legislators and advocacy groups moved quickly to frame the findings, with gun safety organizations calling for tighter access restrictions around government facilities and rights groups warning against broad speech crackdowns. Security experts noted that manifesto content often blends ideological language with personal grievance, complicating straightforward policy conclusions.

> "The evidence suggests targeted fixation on institutions, and that means prevention work must include threat reporting pipelines, not only perimeter hardware." — Dr. Lionel Pace, director of civic violence research at Northeastern Policy Lab

Capitol police leadership will brief lawmakers on revised threat protocols this week, including credentialing updates and expanded digital monitoring partnerships. Families of victims urged officials to avoid politicized leaks that could undermine prosecution and retraumatize affected staff.
$body$
WHERE template_key = 'news_capital_shooting_manifesto';

UPDATE public.simulation_event_templates SET
  summary = 'A hostage video demanding prisoner releases has set a 72-hour deadline and raised pressure on negotiators. U.S. officials are weighing covert options while trying to preserve communication channels.',
  dateline = 'Amman —',
  body = $body$
Militant intermediaries released a video showing three American hostages and demanding a prisoner exchange within seventy-two hours, according to regional media monitors and Western intelligence officials. Analysts said the production quality and distribution timing indicate a coordinated psychological pressure campaign aimed at shaping diplomatic agendas in multiple capitals.

U.S. crisis teams are working with partner governments to validate the hostages identities, assess captor command structure, and test whether the ultimatum timeline is rigid or negotiable. Former negotiators caution that public debate over concessions can harden positions, especially when rival factions seek to outbid one another for influence.

> "Deadlines in hostage videos are often tactical theater, but they can become real if leadership control inside the armed group is fragmented." — Victor Hale, former senior advisor at the National Hostage Recovery Cell

The White House said all options remain under review while emphasizing family privacy and operational security. Regional intelligence services increased surveillance on suspected transit routes in case captors attempt relocation ahead of any rescue or negotiated handoff.
$body$
WHERE template_key = 'news_hostage_ransom';

UPDATE public.simulation_event_templates SET
  summary = 'Talk of expanded sanctions and export controls tied to Strait tensions has rattled technology and shipping markets. Allied capitals are seeking a coordinated approach to avoid signaling fractures.',
  dateline = 'Tokyo —',
  body = $body$
Investors sold semiconductor and shipping stocks after reports that U.S. and allied officials are reviewing additional sanctions and export controls linked to military pressure in the Taiwan Strait. Finance ministries said contingency planning is active, though no final package has been announced and discussions remain sensitive across multiple governments.

Industry executives warned that abrupt controls could disrupt fabrication tool flows, contract manufacturing schedules, and downstream consumer electronics pricing worldwide. Security officials countered that credible economic signaling is necessary to deter coercive maneuvers, arguing that uncertainty itself can be managed if policy timelines are clear and multinational.

> "The objective is strategic clarity, not panic, but markets punish ambiguity when geopolitics and supply chains intersect this directly." — Mei-Lin Park, chief economist at East Pacific Trade Analytics

Diplomats are drafting language for a joint statement that emphasizes de-escalation while preserving leverage. Central banks across the region are monitoring liquidity conditions in case volatility spills beyond technology sectors into broader credit and currency markets.
$body$
WHERE template_key = 'news_taiwan_strait_sanctions';

UPDATE public.simulation_event_templates SET
  summary = 'Power has been partially restored after the Southeast cyberattack, but a dispute over attribution is now complicating recovery messaging. Investigators caution that hidden malware may still be present.',
  dateline = 'Charlotte —',
  body = $body$
Utility operators restored electricity to most hospitals, water treatment facilities, and major transit nodes after days of rolling outages, but officials said full normalization could take another week. Recovery teams continue isolating substations and software environments to ensure that backup systems brought online during the emergency are not carrying latent malware.

Attribution remains contested as federal agencies compare indicators from private security firms, intelligence sources, and partner governments. Political leaders have begun trading accusations before investigators finalize conclusions, raising concern among emergency managers who say premature claims can undermine public trust and international coordination.

> "You can reconnect systems fast or you can reconnect systems safely, and in critical infrastructure those are not always the same timeline." — Rachel Espinoza, incident commander, Southeastern Grid Recovery Task Force

State regulators are now reviewing mutual aid agreements and cybersecurity auditing rules for utility vendors. Congressional committees plan hearings on whether voluntary standards should be replaced with mandatory resilience requirements for software providers tied to the power sector.
$body$
WHERE template_key = 'news_grid_cyberattack_restore';

UPDATE public.simulation_event_templates SET
  summary = 'Hospital executives and nurse unions have exchanged a tentative framework, but core staffing disputes remain unresolved. The proposed deal could stabilize some services without ending nationwide disruption.',
  dateline = 'Philadelphia —',
  body = $body$
Mediators presented a draft framework that includes immediate wage adjustments, retention bonuses, and a phased hiring schedule, offering the first structured compromise since the strike began. Several health systems signaled willingness to adopt interim staffing committees, but union leaders said enforceability remains the central unresolved issue.

Nurse representatives argue previous pledges failed because hospitals could waive targets during surges, leaving bedside teams chronically short. Administrators say strict ratio mandates without emergency flexibility could force unit closures in already understaffed regions, and they want shared oversight mechanisms tied to recruitment and training benchmarks.

> "A deal is possible if hospitals accept transparent staffing triggers and frontline nurses get real authority when patient loads become unsafe." — Carla Mendez, lead negotiator, United Care Workers Alliance

Public health officials urged both sides to lock in at least a temporary agreement before pediatric referrals and long-term care transfers overwhelm remaining capacity. Talks are expected to continue daily with federal mediators present.
$body$
WHERE template_key = 'news_healthcare_strike_deal';

INSERT INTO public.simulation_event_templates (
  template_key, title, summary, category, topic, default_hours, spawn_weight, enabled,
  is_starter, follow_up_of_template_key, assignment_mode, default_severity, dateline, body
) VALUES (
  'news_taiwan_strait_diplomacy',
  'U.S. and China reopen military hotline after near-collision in South China Sea',
  'Washington and Beijing have agreed to restart military communications following a dangerous naval near-collision. Officials say Singapore talks created a narrow path to reduce crisis miscalculation.',
  'international', 'war', 24, 0, true,
  false, 'news_taiwan_strait', 'none', 3, 'Singapore —',
  $body$
Senior U.S. and Chinese officials announced a limited agreement to reopen military-to-military communication channels after a near-collision between naval vessels in the South China Sea intensified regional alarm. The understanding emerged from two days of closed-door talks in Singapore attended by the U.S. Secretary of State, Chinese foreign policy counterparts, and defense delegations from both sides.

The White House said the President had directed negotiators to prioritize incident-prevention mechanisms that can function during periods of political tension, including direct theater-level calls and standardized maritime deconfliction language. Regional partners welcomed the move but cautioned that communication protocols will matter only if commanders receive clear authority to use them in real time.

> "Reopening military lines does not resolve strategic rivalry, but it gives both sides a safer off-ramp when tactical encounters escalate faster than diplomats can react." — Brig. Gen. Aaron Pike, senior U.S. defense official

> "Singapore produced process, not trust; the test will be whether these channels stay open during the next serious confrontation." — Dr. Celia Tan, regional security analyst at the Maritime Asia Institute

Officials in Tokyo, Manila, and Canberra said they would monitor implementation closely, emphasizing that predictable crisis communication is now central to preventing a local incident from becoming a wider regional conflict.
$body$
)
ON CONFLICT (template_key) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  category = EXCLUDED.category,
  topic = EXCLUDED.topic,
  default_hours = EXCLUDED.default_hours,
  enabled = EXCLUDED.enabled,
  is_starter = EXCLUDED.is_starter,
  follow_up_of_template_key = EXCLUDED.follow_up_of_template_key,
  assignment_mode = EXCLUDED.assignment_mode,
  default_severity = EXCLUDED.default_severity,
  dateline = EXCLUDED.dateline,
  body = EXCLUDED.body;

notify pgrst, 'reload schema';

-- Backfill already-published instances from updated pool copy.
update public.simulation_event_instances i
set
  summary = t.summary,
  dateline = t.dateline,
  body = t.body
from public.simulation_event_templates t
where i.template_key = t.template_key
  and t.body is not null
  and (i.body is null or i.body = '');
