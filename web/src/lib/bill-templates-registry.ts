/**
 * Canonical preset bill templates (issue stances). Synced to `bill_templates` via
 * `syncBillTemplatesFromRegistry` so migrations stay small; migration creates empty
 * rows or the sync fills on first deploy.
 */
export type BillTemplateStance = {
  stance_key: string;
  label: string;
  summary: string;
  full_text: string;
  policy_value: number;
};

export type BillTemplateDefinition = {
  issue_key: string;
  display_name: string;
  description: string;
  stances: BillTemplateStance[];
};

function act(title: string, sections: string[]): string {
  const body = sections
    .map((s, i) => `SECTION ${i + 1}. ${s}`)
    .join("\n\n");
  return [
    `${title}`,
    "",
    "Be it enacted by the Senate and House of Representatives of the United States of America in Congress assembled,",
    "",
    body,
    "",
    "SEC. 99. SEVERABILITY.",
    "If any provision of this Act, or the application thereof to any person or circumstance, is held invalid, the remainder of the Act, and the application of such provisions to other persons or circumstances, shall not be affected thereby.",
    "",
    "SEC. 100. EFFECTIVE DATE.",
    "This Act shall take effect on the date of the enactment of this Act.",
  ].join("\n");
}

export const BILL_TEMPLATE_REGISTRY: BillTemplateDefinition[] = [
  {
    issue_key: "abortion",
    display_name: "Abortion Rights",
    description: "Federal standards for reproductive health access and provider regulation.",
    stances: [
      {
        stance_key: "ban",
        label: "National Ban",
        summary: "Prohibit abortion nationwide with limited medical exceptions.",
        policy_value: -2,
        full_text: act(
          "A BILL To establish a nationwide prohibition on elective abortion.",
          [
            "DEFINITIONS.—The term 'abortion' means the use or prescription of any instrument, medicine, drug, or other substance or device intentionally to terminate a clinically diagnosable pregnancy except where necessary to prevent the death of the pregnant patient or to avert serious risk of substantial and irreversible physical impairment of a major bodily function.",
            "PROHIBITION.—It shall be unlawful for any person to perform or attempt to perform an abortion, or knowingly to assist in performing an abortion, in the United States or affecting interstate commerce.",
            "ENFORCEMENT.—The Attorney General may bring a civil action for appropriate relief. Nothing herein shall be construed to authorize prosecution of the pregnant patient.",
          ],
        ),
      },
      {
        stance_key: "restrict",
        label: "Restrict After First Trimester",
        summary: "Allow early access with strict limits after viability and hospital-only requirements.",
        policy_value: -1,
        full_text: act(
          "A BILL To regulate abortion services after the first trimester while preserving early access.",
          [
            "PERMITTED SERVICES.—During the first fourteen weeks of pregnancy, a licensed physician may provide abortion services consistent with applicable state licensing and informed-consent requirements.",
            "POST-FOURTEEN WEEKS.—After fourteen weeks' gestation, abortion may be performed only in a hospital licensed by the State, and only where two physicians certify that continuation of the pregnancy poses a serious risk to the life or health of the pregnant patient.",
            "REPORTING.—States shall maintain de-identified statistical reports submitted annually to the Secretary of Health and Human Services.",
          ],
        ),
      },
      {
        stance_key: "codify_roe",
        label: "Codify Roe Framework",
        summary: "Statutorily restore pre-Dobbs undue-burden and viability standards.",
        policy_value: 1,
        full_text: act(
          "A BILL To codify the essential holdings of Roe v. Wade and Planned Parenthood of Southeastern Pa. v. Casey.",
          [
            "FUNDAMENTAL RIGHT.—Prior to fetal viability, the choice to terminate a pregnancy shall not be unduly burdened by federal or state regulation.",
            "VIABILITY STANDARD.—After viability, Congress recognizes the concurrent interests in potential life and maternal health; regulations shall be permitted only where they further a compelling state interest and employ the least restrictive means.",
            "PREEMPTION CLAUSE.—Any state law that imposes an undue burden on abortion access prior to viability is preempted to the extent of the inconsistency.",
          ],
        ),
      },
      {
        stance_key: "constitutional_right",
        label: "Constitutional Right",
        summary: "Declare reproductive autonomy a federal statutory constitutional entitlement nationwide.",
        policy_value: 2,
        full_text: act(
          "A BILL To recognize and enforce a federal statutory right to reproductive autonomy.",
          [
            "RIGHT DECLARED.—Every person possesses the right to make and effectuate decisions about pregnancy, including the right to obtain abortion services without medically unnecessary delay or requirement.",
            "PROVIDER PROTECTION.—No officer or employee of the United States or any State shall penalize, sanction, or discriminate against a health care provider for furnishing lawful abortion services.",
            "PRIVATE RIGHT OF ACTION.—Any person aggrieved by a violation of this Act may bring an action in a United States district court for declaratory and injunctive relief and for damages as the court deems appropriate.",
          ],
        ),
      },
    ],
  },
  {
    issue_key: "gun_control",
    display_name: "Gun Control",
    description: "Federal firearms commerce, background checks, and assault-style weapons policy.",
    stances: [
      {
        stance_key: "deregulate",
        label: "Deregulate Interstate Carry",
        summary: "National reciprocity for concealed carry and limits on ATF rulemaking.",
        policy_value: -2,
        full_text: act(
          "A BILL To protect lawful interstate transportation and recognition of concealed-carry privileges.",
          [
            "RECIPROCITY.—Any person who is not prohibited from possessing firearms under Federal law and who holds a valid concealed-carry permit issued by any State may carry a concealed handgun in any other State that issues concealed-carry permits.",
            "TRANSPORTATION.—Firearms unloaded and locked in a vehicle trunk or locked container shall not be deemed 'carrying' for purposes of local prohibitions during continuous interstate travel.",
            "RULEMAKING MORATORIUM.—For ten years following enactment, the Bureau of Alcohol, Tobacco, Firearms and Explosives shall not promulgate rules that reclassify commonly possessed semi-automatic rifles as Title II weapons absent express congressional authorization.",
          ],
        ),
      },
      {
        stance_key: "background_checks",
        label: "Universal Background Checks",
        summary: "Close private-sale loopholes with NICS checks and misdemeanor domestic-violence alignment.",
        policy_value: -1,
        full_text: act(
          "A BILL To require background checks for all firearm transfers.",
          [
            "LICENSED DEALER TRANSFERS.—All transfers involving a licensed dealer shall be processed through the National Instant Criminal Background Check System prior to delivery.",
            "PRIVATE TRANSFERS.—Private parties shall complete transfers only through a licensed dealer or designated law-enforcement agency, except for temporary loans at shooting ranges and transfers between immediate family members residing in the same household.",
            "RETENTION.—Dealers shall retain Form 4473 records for twenty years and make them available to ATF for tracing upon lawful request.",
          ],
        ),
      },
      {
        stance_key: "assault_weapons_ban",
        label: "Assault Weapons Ban",
        summary: "Prohibit new sales of listed semi-automatic rifles and large-capacity magazines.",
        policy_value: 1,
        full_text: act(
          "A BILL To regulate assault weapons and large capacity ammunition feeding devices.",
          [
            "DEFINITION.—The term 'assault weapon' means a semi-automatic rifle that accepts a detachable magazine and has any two listed military-style features set forth in subsection (b) of this section.",
            "PROHIBITED CONDUCT.—It shall be unlawful to manufacture, import, sell, or transfer an assault weapon or a large capacity ammunition feeding device holding more than ten rounds, except to the United States or a law enforcement agency.",
            "GRANDFATHERING.—Persons lawfully possessing covered weapons before the effective date may retain them if registered pursuant to regulations issued by the Attorney General.",
          ],
        ),
      },
      {
        stance_key: "full_ban",
        label: "Mandatory Buyback",
        summary: "Phase out civilian possession of semi-automatic centerfire rifles and fund buybacks.",
        policy_value: 2,
        full_text: act(
          "A BILL To reduce civilian possession of military-style firearms through a compensated transition program.",
          [
            "COVERED FIREARMS.—The term 'covered firearm' includes semi-automatic centerfire rifles capable of accepting detachable magazines and semi-automatic pistols with certain listed features.",
            "BUYBACK PROGRAM.—The Attorney General shall establish a voluntary buyback program compensating lawful owners at fair market value, funded through appropriations authorized in this Act.",
            "POSSESSION AFTER WINDOW.—After the sunset of the buyback period, civilian possession of covered firearms outside narrow sporting exemptions shall be unlawful except for licensed museums.",
          ],
        ),
      },
    ],
  },
  {
    issue_key: "healthcare",
    display_name: "Healthcare System",
    description: "Coverage models, subsidies, and public plan options.",
    stances: [
      {
        stance_key: "privatize",
        label: "Block Grants & HSAs",
        summary: "Convert Medicaid expansion funds to state block grants and expand HSAs.",
        policy_value: -2,
        full_text: act(
          "A BILL To convert certain Medicaid funds into flexible state block grants and expand health savings accounts.",
          [
            "BLOCK GRANTS.—Federal Medicaid matching payments for the adult expansion population shall be replaced by capped allotments to States beginning in fiscal year following enactment.",
            "HSA EXPANSION.—Annual contribution limits shall be doubled and qualified medical expenses shall include direct primary care membership fees.",
            "STATE WAIVER DEFAULT.—States shall have a rebuttable presumption of approval for waivers that introduce work requirements for able-bodied adults without dependents.",
          ],
        ),
      },
      {
        stance_key: "aca_repeal",
        label: "Repeal ACA Individual Mandate Provisions",
        summary: "Remove individual mandate tax and associated reporting while preserving pre-existing condition rules.",
        policy_value: -1,
        full_text: act(
          "A BILL To amend the Internal Revenue Code of 1986 to repeal certain Affordable Care Act tax provisions.",
          [
            "INDIVIDUAL SHARED RESPONSIBILITY.—Section 5000A of the Internal Revenue Code of 1986 is repealed effective for taxable years beginning after December 31 of the year of enactment.",
            "REPORTING.—Employers shall not be required to report coverage offers solely for purposes of the repealed penalty.",
            "INSURANCE REFORMS.—Sections 2711 through 2719 of the Public Health Service Act shall remain in force, including protections for dependents and prohibitions on lifetime limits for essential health benefits.",
          ],
        ),
      },
      {
        stance_key: "public_option",
        label: "Public Option",
        summary: "Medicare-like plan offered on all Marketplaces with negotiated rates.",
        policy_value: 1,
        full_text: act(
          "A BILL To establish a public health insurance option on Federal and State Marketplaces.",
          [
            "ESTABLISHMENT.—The Secretary of Health and Human Services shall offer a 'Federal Health Plan' in every rating area where a qualified health plan is offered.",
            "PAYMENT RATES.—The Federal Health Plan shall reimburse providers at not less than Medicare rates and not more than Medicare rates plus fifteen percent.",
            "SUBSIDIES.—Advance premium tax credits and cost-sharing reductions shall apply to Federal Health Plan enrollees on the same basis as for qualified health plans.",
          ],
        ),
      },
      {
        stance_key: "universal",
        label: "Medicare for All Framework",
        summary: "Single-payer national health insurance with phased provider transition.",
        policy_value: 2,
        full_text: act(
          "A BILL To establish a single-payer national health program.",
          [
            "PROGRAM CREATION.—There is hereby established the United States National Health Insurance Program to finance medically necessary services without cost-sharing at the point of service for covered individuals.",
            "COVERED BENEFITS.—Benefits shall include hospital, physician, mental health, dental, vision, prescription drug, and long-term supports and services as defined by the Board.",
            "TRANSITION.—Private Medicare Advantage contracts shall sunset pursuant to a schedule issued by the Secretary, with continuity protections for enrollees.",
          ],
        ),
      },
    ],
  },
  {
    issue_key: "immigration",
    display_name: "Immigration Policy",
    description: "Border security, enforcement, and pathways to status.",
    stances: [
      {
        stance_key: "closed_borders",
        label: "Closed Borders",
        summary: "Moratorium on most new immigrant visas pending review.",
        policy_value: -2,
        full_text: act(
          "A BILL To pause certain immigrant admissions for national security review.",
          [
            "MORATORIUM.—For a period of thirty-six months, the annual numerical limitation under section 201 of the Immigration and Nationality Act shall be reduced by fifty percent for family-sponsored and employment-based preferences, except for spouses and minor children of United States citizens.",
            "ASYLUM.—All applicants for asylum shall be detained or subject to supervised release with electronic monitoring pending credible-fear adjudication.",
            "SANCTUARY PREEMPTION.—No State or political subdivision may restrict communication with the Department of Homeland Security regarding citizenship or immigration status.",
          ],
        ),
      },
      {
        stance_key: "enforcement_first",
        label: "Enforcement First",
        summary: "Mandatory E-Verify, border technology surge, and merit-based caps.",
        policy_value: -1,
        full_text: act(
          "A BILL To strengthen employment eligibility verification and border security.",
          [
            "E-VERIFY.—All employers shall participate in E-Verify for new hires within two years of enactment.",
            "BORDER INFRASTRUCTURE.—There are authorized to be appropriated such sums as may be necessary for pedestrian fencing, sensors, and ports-of-entry modernization.",
            "VISA CAPS.—The Secretary of State shall allocate employment-based visas using a points system prioritizing education, language proficiency, and labor-market needs.",
          ],
        ),
      },
      {
        stance_key: "pathway_to_citizenship",
        label: "Pathway to Citizenship",
        summary: "Earned legalization for long-term residents with security triggers.",
        policy_value: 1,
        full_text: act(
          "A BILL To provide an earned pathway to lawful permanent resident status.",
          [
            "ELIGIBILITY.—A noncitizen who has been continuously physically present in the United States since January 1, 2015, and who satisfies background and tax requirements may apply for conditional resident status.",
            "CONDITIONAL PERIOD.—Conditional status shall be granted for eight years, after which the Secretary may remove conditions upon demonstration of employment, education, or military service benchmarks.",
            "BORDER TRIGGERS.—Implementation of final green-card applications for certain categories shall be tied to certification of biometric entry-exit completion at major air and sea ports.",
          ],
        ),
      },
      {
        stance_key: "open_borders",
        label: "Open Borders",
        summary: "Demilitarize interior enforcement and expand humanitarian parole.",
        policy_value: 2,
        full_text: act(
          "A BILL To refocus immigration enforcement on serious criminal conduct and expand lawful entry channels.",
          [
            "INTERIOR ENFORCEMENT.—The Department of Homeland Security shall not conduct civil immigration arrests at schools, hospitals, or places of worship absent exigent circumstances involving violent felonies.",
            "PAROLE.—The Secretary shall establish categorical parole programs for climate-displaced persons and family reunification cases subject to fraud-prevention screening.",
            "VISA AVAILABILITY.—Unused employment-based visa numbers shall roll over to family-based categories in the following fiscal year.",
          ],
        ),
      },
    ],
  },
  {
    issue_key: "minimum_wage",
    display_name: "Minimum Wage",
    description: "Federal minimum wage levels and indexing.",
    stances: [
      {
        stance_key: "freeze",
        label: "Freeze Federal Floor",
        summary: "Maintain current federal minimum wage and preempt state increases above a cap.",
        policy_value: -2,
        full_text: act(
          "A BILL To freeze the federal minimum wage and harmonize state preemption standards.",
          [
            "RATE.—The minimum wage under section 6(a)(1) of the Fair Labor Standards Act of 1938 shall remain at the rate in effect on the day before the date of enactment of this Act for ten years.",
            "PREEMPTION.—No State or locality may require an hourly wage more than twenty percent above the federal minimum for employers engaged in interstate commerce below five hundred employees.",
            "TIP CREDIT.—The cash wage required for tipped employees shall not increase for ten years.",
          ],
        ),
      },
      {
        stance_key: "raise_to_15",
        label: "Raise to $15",
        summary: "Phased increase to $15/hour by 2028 with youth subminimum sunset.",
        policy_value: -1,
        full_text: act(
          "A BILL To increase the federal minimum wage to $15 an hour.",
          [
            "SCHEDULE.—Section 6(a)(1) of the Fair Labor Standards Act of 1938 is amended to provide annual stepped increases until the hourly rate equals $15.00.",
            "YOUTH SUBMINIMUM.—The Secretary shall phase out separate youth subminimum wages for newly covered employees over five years.",
            "SMALL BUSINESS CREDIT.—Employers with fewer than twenty employees may claim a payroll tax credit equal to a percentage of increased wage costs as prescribed by the Secretary of the Treasury.",
          ],
        ),
      },
      {
        stance_key: "raise_to_20",
        label: "Raise to $20",
        summary: "Accelerated path to $20 with regional COLA adjustments.",
        policy_value: 1,
        full_text: act(
          "A BILL To establish a $20 federal minimum wage with regional adjustments.",
          [
            "BASE RATE.—The minimum wage shall reach $20.00 per hour not later than five years after enactment.",
            "REGIONAL ADJUSTMENTS.—The Bureau of Labor Statistics shall publish regional price parities; employers in low-cost areas may apply a discount not to exceed seven percent of the base rate.",
            "INDEXING.—Beginning in the sixth year, the minimum wage shall increase annually by the percentage increase in the Consumer Price Index for Urban Wage Earners and Clerical Workers.",
          ],
        ),
      },
      {
        stance_key: "living_wage_indexed",
        label: "Living Wage and Indexing",
        summary: "Tie minimum to county median rent and index automatically.",
        policy_value: 2,
        full_text: act(
          "A BILL To establish a living wage tied to housing costs.",
          [
            "LIVING WAGE FORMULA.—The Secretary of Labor shall annually publish a county-level living wage equal to forty percent of median gross rent for a two-bedroom unit divided by one hundred thirty hours.",
            "FLOOR AND CEILING.—No county rate shall be below $18.00 or above $35.00 in the first five years, after which the ceiling shall float with national median wages.",
            "ENFORCEMENT.—The Secretary may assess civil penalties for willful violations and shall coordinate data sharing with the Department of Housing and Urban Development.",
          ],
        ),
      },
    ],
  },
  {
    issue_key: "climate",
    display_name: "Climate Policy",
    description: "Federal energy mix, emissions targets, and investment programs.",
    stances: [
      {
        stance_key: "deregulate",
        label: "Deregulate Energy",
        summary: "Limit EPA GHG rules under major questions doctrine analogue.",
        policy_value: -2,
        full_text: act(
          "A BILL To limit agency authority to regulate greenhouse gas emissions from stationary sources absent express statutory standards.",
          [
            "STATUTORY BAR.—No agency may promulgate economy-wide performance standards for greenhouse gas emissions from existing power plants unless Congress enacts a joint resolution approving the specific numeric limit.",
            "PERMITTING.—National Environmental Policy Act reviews for fossil fuel pipelines shall presumptively conclude within one year absent a showing of significant new information.",
            "EXPORTS.—Liquefied natural gas export terminals shall receive deemed approval if the Department of Energy fails to act within ninety days.",
          ],
        ),
      },
      {
        stance_key: "voluntary_targets",
        label: "Voluntary Industry Targets",
        summary: "Tax credits for voluntary reductions without binding caps.",
        policy_value: -1,
        full_text: act(
          "A BILL To incentivize voluntary greenhouse gas intensity reductions.",
          [
            "CREDIT.—Manufacturers that achieve a ten percent reduction in facility-level greenhouse gas intensity compared to a baseline year may claim a refundable tax credit as prescribed by the Secretary of the Treasury.",
            "REPORTING.—Participation shall be voluntary; trade secrets submitted to the Environmental Protection Agency shall be protected from disclosure except in aggregate form.",
            "RESEARCH.—There are authorized to be appropriated sums for carbon capture utilization and storage demonstration projects at coal and gas plants.",
          ],
        ),
      },
      {
        stance_key: "paris_accord",
        label: "Paris Accord Alignment",
        summary: "Binding NDC-style targets and methane rules.",
        policy_value: 1,
        full_text: act(
          "A BILL To align United States law with the Paris Agreement and strengthen methane regulation.",
          [
            "NDC IMPLEMENTATION.—The President shall submit to Congress an annual plan to meet nationally determined contribution targets, including sector-specific benchmarks for electricity, transportation, and buildings.",
            "METHANE.—The Environmental Protection Agency shall issue performance standards for methane leaks from new and existing oil and gas production facilities.",
            "GREEN BANK.—There is established a National Climate Bank to finance clean energy infrastructure in disadvantaged communities.",
          ],
        ),
      },
      {
        stance_key: "green_new_deal",
        label: "Green New Deal Framework",
        summary: "Large-scale public jobs and decarbonization investment program.",
        policy_value: 2,
        full_text: act(
          "A BILL To mobilize public resources for a ten-year national mobilization against climate change.",
          [
            "MOBILIZATION GOALS.—Federal agencies shall prioritize projects that achieve one hundred percent clean, renewable, zero-emission energy sources for electricity not later than fifteen years after enactment.",
            "JUST TRANSITION.—The Secretary of Labor shall administer grants for wage insurance, apprenticeship programs, and early retirement benefits for workers in carbon-intensive industries.",
            "PUBLIC OWNERSHIP OPTION.—Municipalities may petition the Secretary of Energy for low-interest loans to acquire investor-owned utilities where consistent with state law.",
          ],
        ),
      },
    ],
  },
  {
    issue_key: "student_debt",
    display_name: "Student Debt",
    description: "Repayment, forgiveness, and bankruptcy treatment.",
    stances: [
      {
        stance_key: "no_action",
        label: "No Federal Forgiveness",
        summary: "Affirm current repayment structures; narrow PSLF fraud review only.",
        policy_value: -2,
        full_text: act(
          "A BILL To reaffirm borrower responsibility for federal student loans.",
          [
            "NO BLANKET FORGIVENESS.—The Secretary of Education shall not implement any program of blanket loan cancellation except as expressly authorized in this title or subsequent Acts.",
            "PSLF INTEGRITY.—The Secretary shall conduct audits of employer certifications for Public Service Loan Forgiveness and shall recover improperly forgiven amounts.",
            "CAP INTEREST CAPITALIZATION.—Interest shall not capitalize more than once annually during periods of forbearance.",
          ],
        ),
      },
      {
        stance_key: "income_based_reform",
        label: "Income-Based Reform",
        summary: "Cap payments at 5% discretionary income and shorten forgiveness horizon.",
        policy_value: -1,
        full_text: act(
          "A BILL To reform income-driven repayment for federal student loans.",
          [
            "PAYMENT CAP.—Borrowers in an income-driven repayment plan shall pay five percent of discretionary income on undergraduate loans and ten percent on graduate loans.",
            "FORGIVENESS HORIZON.—Remaining balances shall be forgiven after twenty years of qualifying payments for undergraduate borrowers and twenty-five years for graduate borrowers.",
            "TAX TREATMENT.—Amounts forgiven shall not be treated as gross income for federal income tax purposes.",
          ],
        ),
      },
      {
        stance_key: "partial_forgiveness",
        label: "Partial Forgiveness",
        summary: "Forgive $25,000 for Pell recipients meeting income tests.",
        policy_value: 1,
        full_text: act(
          "A BILL To provide targeted federal student loan forgiveness.",
          [
            "AMOUNT.—The Secretary of Education shall cancel up to $25,000 of outstanding principal and interest on eligible Federal Direct Loans for borrowers who received a Federal Pell Grant while enrolled.",
            "INCOME PHASEOUT.—Benefits phase out beginning at modified adjusted gross income of $125,000 for single filers and $250,000 for joint filers.",
            "SERVICER AUDIT.—The Secretary shall rebid loan servicing contracts with performance metrics tied to borrower outcomes.",
          ],
        ),
      },
      {
        stance_key: "full_cancellation",
        label: "Full Cancellation",
        summary: "Cancel all federal student loan debt with revenue offset package.",
        policy_value: 2,
        full_text: act(
          "A BILL To cancel Federal Direct Loan obligations and establish offsets.",
          [
            "CANCELLATION.—The Secretary of Education shall discharge all principal and interest due on Federal Direct Loans and Federal Family Education Loans held by the Department as of the effective date.",
            "CREDIT REPORTING.—Consumer reporting agencies shall delete tradelines relating to discharged loans within sixty days of notice from the Secretary.",
            "OFFSETS.—The Joint Committee on Taxation shall report revenue measures sufficient to cover the budgetary effects of cancellation, including a surtax on ultra-high adjusted gross incomes as described in committee print.",
          ],
        ),
      },
    ],
  },
  {
    issue_key: "drug_policy",
    display_name: "Drug Policy",
    description: "Scheduling, enforcement, decriminalization, and legalization frameworks.",
    stances: [
      {
        stance_key: "stricter_enforcement",
        label: "Stricter Enforcement",
        summary: "Mandatory minimums for fentanyl analogues and federal-local task forces.",
        policy_value: -2,
        full_text: act(
          "A BILL To increase penalties for trafficking in fentanyl-related substances.",
          [
            "SENTENCING.—Trafficking offenses involving detectable quantities of fentanyl or fentanyl analogues shall carry a ten-year mandatory minimum sentence absent substantial assistance.",
            "TASK FORCES.—The Attorney General shall establish joint task forces in high-overdose counties combining DEA, FBI, and state and local officers.",
            "PRECURSOR CONTROLS.—The Attorney General may by interim order schedule precursor chemicals pending permanent rulemaking.",
          ],
        ),
      },
      {
        stance_key: "maintain_status_quo",
        label: "Maintain Status Quo",
        summary: "Codify current CSA schedules with research exceptions only.",
        policy_value: -1,
        full_text: act(
          "A BILL To codify current drug scheduling and expand research access.",
          [
            "SCHEDULES.—The schedules of controlled substances in section 202 of the Controlled Substances Act shall remain as in effect on the day before the date of enactment, except as provided in subsection (b).",
            "RESEARCH.—Registered investigators may obtain Schedule I substances for FDA-approved clinical trials through a centralized procurement office at the National Institutes of Health.",
            "GRANTS.—There are authorized to be appropriated sums for state prescription drug monitoring program interoperability improvements.",
          ],
        ),
      },
      {
        stance_key: "decriminalize",
        label: "Federal Decriminalization",
        summary: "Remove federal criminal penalties for personal possession; expunge records.",
        policy_value: 1,
        full_text: act(
          "A BILL To decriminalize personal possession of certain controlled substances under Federal law.",
          [
            "POSSESSION.—It shall not be a Federal crime for an adult to possess for personal use not more than thirty grams of marijuana or marijuana concentrate in jurisdictions that regulate marijuana.",
            "EXPUNGEMENT.—The Attorney General shall establish an administrative process to vacate and expunge prior Federal convictions solely for covered possession offenses.",
            "GRANTS.—The Bureau of Justice Assistance shall award grants for diversion and treatment programs.",
          ],
        ),
      },
      {
        stance_key: "full_legalization",
        label: "Federal Legalization & Regulation",
        summary: "Deschedule cannabis, FDA-light labeling, state opt-out.",
        policy_value: 2,
        full_text: act(
          "A BILL To remove marijuana from the Controlled Substances Act and regulate interstate commerce.",
          [
            "REMOVAL.—Marijuana and tetrahydrocannabinols derived from marijuana shall be removed from all schedules under section 202 of the Controlled Substances Act.",
            "FDA LABELING.—The Food and Drug Administration shall promulgate labeling and packaging rules for marijuana products sold in interstate commerce, including child-resistant packaging and potency caps for edible products.",
            "STATE OPT-OUT.—A State may prohibit retail marijuana sales within its borders by enactment of a statute expressly referencing this section.",
          ],
        ),
      },
    ],
  },
];
