-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — seed.sql  (§8 of veritas-architecture-v1.md)
-- 10 domains · ~20 canonical unanswered questions · ~15 hypotheses spanning
-- the taxonomy · ~30 evidence entries from real, citable sources, linked both
-- supportively and oppositionally so the contradiction engine and evidence
-- ledger demonstrate non-trivially on day one.
--
-- Epistemic standard (§8): NO seeded speculation above confidence 40, and
-- every value obeys the epistemics_consistent constraint. Confidence scores
-- are honest — the deep metaphysical hypotheses sit in 'unknown'/'speculation';
-- only well-established background physics sits higher.
--
-- Idempotent: safe to re-run. Uses deterministic UUIDs so links resolve
-- without RETURNING plumbing, and `on conflict do nothing` everywhere.
-- created_by is left null (system seed); RLS admin-writes still apply when run
-- via the service role / SQL editor (auth.uid() is null → triggers allow it).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ─── Domains ─────────────────────────────────────────────────────────────────

insert into domains (id, slug, name, icon, sort_order, overview, research_status) values
('d0000001-0000-4000-8000-000000000001','physics','Fundamental Physics','atom',10,
 'The search for the deepest layer of physical law — what the universe is made of and the rules it obeys.',
 'The Standard Model and general relativity are spectacularly confirmed yet known to be incomplete: they do not combine, and they leave dark matter, dark energy, and the quantum-gravity regime unexplained.'),
('d0000002-0000-4000-8000-000000000002','cosmology','Cosmology & Origins','orbit',20,
 'The origin, composition, and ultimate fate of the universe as a whole.',
 'The hot Big Bang and ΛCDM model fit a wide range of observations, but the initial conditions, the nature of inflation, and ~95% of the energy budget remain open.'),
('d0000003-0000-4000-8000-000000000003','consciousness','Consciousness & Mind','brain',30,
 'How and why subjective experience arises, and what its relationship to physical processes is.',
 'Neuroscience maps ever-finer correlates of experience, but the "hard problem" — why there is something it is like to be a system at all — has no consensus explanation.'),
('d0000004-0000-4000-8000-000000000004','quantum','Quantum Foundations','waves',40,
 'What quantum mechanics is actually telling us about reality beneath the equations that work.',
 'The formalism is unreasonably accurate; its interpretation is unsettled. Measurement, nonlocality, and the status of the wavefunction remain contested a century on.'),
('d0000005-0000-4000-8000-000000000005','mathematics','Mathematics & Reality','sigma',50,
 'The nature of mathematical objects and the uncanny effectiveness of mathematics in describing the world.',
 'Whether mathematics is discovered or invented, and why physical law is so mathematical, are live questions at the border of philosophy and physics.'),
('d0000006-0000-4000-8000-000000000006','origin-of-life','Origin of Life','dna',60,
 'How non-living chemistry became self-replicating, evolving biology.',
 'Plausible prebiotic chemistries exist for many building blocks, but no demonstrated continuous path from geochemistry to a living cell, and the order of events is debated.'),
('d0000007-0000-4000-8000-000000000007','information','Information & Computation','binary',70,
 'The role of information as a possibly fundamental ingredient of physical reality.',
 'Information-theoretic reconstructions of quantum theory and black-hole thermodynamics hint at a deep role for information, but "it from bit" remains a research program, not a result.'),
('d0000008-0000-4000-8000-000000000008','time','Time & Causality','clock',80,
 'What time is, whether it flows, and why it has a direction.',
 'Physics is largely time-symmetric, yet the universe has a strong thermodynamic arrow. Whether time is fundamental or emergent is unresolved.'),
('d0000009-0000-4000-8000-000000000009','existence','Existence & Metaphysics','infinity',90,
 'The most basic questions: why anything exists, and whether the universe is fine-tuned or one of many.',
 'These questions border on the empirically inaccessible; progress is largely conceptual, and candidate answers (multiverse, brute fact, necessity) are hard to test.'),
('d0000010-0000-4000-8000-000000000010','astrobiology','Life in the Universe','telescope',100,
 'Whether life and intelligence are common or rare, and where to look.',
 'Thousands of exoplanets are now known and biosignature methods are maturing, but we have exactly one confirmed example of life and no detection beyond Earth.')
on conflict (id) do nothing;

-- ─── Sources (real, citable) ─────────────────────────────────────────────────

insert into sources (id, title, authors, url, doi, source_type, year, reliability) values
('50000001-0000-4000-8000-000000000001','Planck 2018 results. VI. Cosmological parameters','Planck Collaboration','https://www.aanda.org/articles/aa/full_html/2020/09/aa33910-18/aa33910-18.html','10.1051/0004-6361/201833910','peer_reviewed',2020,95),
('50000002-0000-4000-8000-000000000002','A direct empirical proof of the existence of dark matter (Bullet Cluster)','Clowe et al.','https://iopscience.iop.org/article/10.1086/508162','10.1086/508162','peer_reviewed',2006,90),
('50000003-0000-4000-8000-000000000003','Observational evidence from supernovae for an accelerating universe','Riess et al.','https://iopscience.iop.org/article/10.1086/300499','10.1086/300499','peer_reviewed',1998,92),
('50000004-0000-4000-8000-000000000004','Facing up to the problem of consciousness','David J. Chalmers','https://consc.net/papers/facing.html',null,'philosophical_argument',1995,80),
('50000005-0000-4000-8000-000000000005','An Information Integration Theory of Consciousness','Giulio Tononi','https://bmcneurosci.biomedcentral.com/articles/10.1186/1471-2202-5-42','10.1186/1471-2202-5-42','peer_reviewed',2004,72),
('50000006-0000-4000-8000-000000000006','Experimental test of local hidden-variable theories (Bell test)','Alain Aspect et al.','https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.49.1804','10.1103/PhysRevLett.49.1804','peer_reviewed',1982,93),
('50000007-0000-4000-8000-000000000007','Loophole-free Bell inequality violation using electron spins separated by 1.3 km','Hensen et al.','https://www.nature.com/articles/nature15759','10.1038/nature15759','peer_reviewed',2015,95),
('50000008-0000-4000-8000-000000000008','The Unreasonable Effectiveness of Mathematics in the Natural Sciences','Eugene Wigner','https://www.maths.ed.ac.uk/~v1ranick/papers/wigner.pdf',null,'philosophical_argument',1960,82),
('50000009-0000-4000-8000-000000000009','The Mathematical Universe','Max Tegmark','https://arxiv.org/abs/0704.0646','10.1007/s10701-007-9186-9','preprint',2008,55),
('5000000a-0000-4000-8000-00000000000a','A Production of Amino Acids Under Possible Primitive Earth Conditions (Miller–Urey)','Stanley L. Miller','https://www.science.org/doi/10.1126/science.117.3046.528','10.1126/science.117.3046.528','experiment',1953,88),
('5000000b-0000-4000-8000-00000000000b','Synthesis of activated pyrimidine ribonucleotides in prebiotically plausible conditions','Powner, Gerland & Sutherland','https://www.nature.com/articles/nature08013','10.1038/nature08013','peer_reviewed',2009,85),
('5000000c-0000-4000-8000-00000000000c','Black holes and entropy','Jacob D. Bekenstein','https://journals.aps.org/prd/abstract/10.1103/PhysRevD.7.2333','10.1103/PhysRevD.7.2333','peer_reviewed',1973,90),
('5000000d-0000-4000-8000-00000000000d','Particle creation by black holes (Hawking radiation)','S. W. Hawking','https://link.springer.com/article/10.1007/BF02345020','10.1007/BF02345020','peer_reviewed',1975,92),
('5000000e-0000-4000-8000-00000000000e','The Large-Scale Structure of Space-Time','Hawking & Ellis',null,null,'book',1973,88),
('5000000f-0000-4000-8000-00000000000f','Maldacena: The Large-N limit of superconformal field theories and supergravity (AdS/CFT)','Juan Maldacena','https://arxiv.org/abs/hep-th/9711200','10.4310/ATMP.1998.v2.n2.a1','peer_reviewed',1998,84),
('50000010-0000-4000-8000-000000000010','Entropic gravity: On the Origin of Gravity and the Laws of Newton','Erik Verlinde','https://arxiv.org/abs/1001.0785','10.1007/JHEP04(2011)029','preprint',2011,52),
('50000011-0000-4000-8000-000000000011','Can Quantum-Mechanical Description of Physical Reality Be Considered Complete? (EPR)','Einstein, Podolsky, Rosen','https://journals.aps.org/pr/abstract/10.1103/PhysRev.47.777','10.1103/PhysRev.47.777','peer_reviewed',1935,86),
('50000012-0000-4000-8000-000000000012','The Astonishing Hypothesis: The Scientific Search for the Soul','Francis Crick',null,null,'book',1994,70),
('50000013-0000-4000-8000-000000000013','Consciousness and Neuroscience (neural correlates of consciousness)','Crick & Koch','https://academic.oup.com/cercor/article-abstract/8/2/97/356402','10.1093/cercor/8.2.97','peer_reviewed',1998,80),
('50000014-0000-4000-8000-000000000014','The cosmological constant problem','Steven Weinberg','https://journals.aps.org/rmp/abstract/10.1103/RevModPhys.61.1','10.1103/RevModPhys.61.1','peer_reviewed',1989,90),
('50000015-0000-4000-8000-000000000015','Inflationary universe: A possible solution to the horizon and flatness problems','Alan H. Guth','https://journals.aps.org/prd/abstract/10.1103/PhysRevD.23.347','10.1103/PhysRevD.23.347','peer_reviewed',1981,88),
('50000016-0000-4000-8000-000000000016','Planck 2018 results. X. Constraints on inflation','Planck Collaboration','https://www.aanda.org/articles/aa/full_html/2020/09/aa33887-18/aa33887-18.html','10.1051/0004-6361/201833887','peer_reviewed',2020,90),
('50000017-0000-4000-8000-000000000017','Rotation of the Andromeda Nebula from a Spectroscopic Survey (galaxy rotation curves)','Vera C. Rubin & W. Kent Ford','https://ui.adsabs.harvard.edu/abs/1970ApJ...159..379R','10.1086/150317','observation',1970,88),
('50000018-0000-4000-8000-000000000018','A determination of the Hubble constant with Hubble Space Telescope (Hubble tension, SH0ES)','Riess et al.','https://arxiv.org/abs/2112.04510','10.3847/2041-8213/ac5c5b','peer_reviewed',2022,84),
('50000019-0000-4000-8000-000000000019','MOND: A modification of the Newtonian dynamics as an alternative to dark matter','Mordehai Milgrom','https://ui.adsabs.harvard.edu/abs/1983ApJ...270..365M','10.1086/161130','peer_reviewed',1983,68),
('5000001a-0000-4000-8000-00000000001a','Integrated information theory: from consciousness to its physical substrate','Tononi, Boly, Massimini & Koch','https://www.nature.com/articles/nrn.2016.44','10.1038/nrn.2016.44','peer_reviewed',2016,74),
('5000001b-0000-4000-8000-00000000001b','LUX-ZEPLIN (LZ): First dark matter search results','LZ Collaboration','https://arxiv.org/abs/2207.03764','10.1103/PhysRevLett.131.041002','peer_reviewed',2023,86),
('5000001c-0000-4000-8000-00000000001c','Wheeler: Information, physics, quantum — the search for links ("it from bit")','John A. Wheeler',null,null,'philosophical_argument',1990,72),
('5000001d-0000-4000-8000-00000000001d','A Confutation of Convergent Realism','Larry Laudan','https://www.journals.uchicago.edu/doi/10.1086/289003','10.1086/289003','philosophical_argument',1981,74),
('5000001e-0000-4000-8000-00000000001e','The Emperor''s New Mind (Orch-OR background)','Roger Penrose',null,null,'book',1989,60),
('5000001f-0000-4000-8000-00000000001f','James Webb Space Telescope Early Release Science','STScI / JWST','https://www.stsci.edu/jwst','10.1088/1538-3873/acb293','observation',2023,88)
on conflict (id) do nothing;

-- ─── Questions (~20 canonical unanswered questions) ──────────────────────────

insert into questions (id, slug, domain_id, title, description, importance, status, current_explanations, research_progress) values
('60000001-0000-4000-8000-000000000001','something-rather-than-nothing','d0000009-0000-4000-8000-000000000009',
 'Why is there something rather than nothing?',
 'The most basic metaphysical question: why does a universe exist at all, rather than a complete absence of anything?',
 99,'unknown',
 'Candidate stances include: existence as a brute fact; a "nothing" state being unstable; necessity arguments; and selection within a multiverse. None is empirically decisive.',
 'Largely a conceptual frontier. Quantum cosmology offers models where a universe can arise from a vacuum state, but "nothing" in those models is already a physical something.'),
('60000002-0000-4000-8000-000000000002','hard-problem-consciousness','d0000003-0000-4000-8000-000000000003',
 'Why is there subjective experience at all?',
 'The "hard problem": even a complete physical account of the brain seems to leave unexplained why any of it is accompanied by felt experience.',
 97,'unknown',
 'Physicalism holds experience will reduce to brain processes; dualism and panpsychism deny full reduction; illusionism denies the explanandum. The debate is unresolved.',
 'Neural correlates of consciousness are increasingly well mapped, and theories like IIT and global workspace make testable predictions, but none closes the explanatory gap.'),
('60000003-0000-4000-8000-000000000003','what-happened-before-big-bang','d0000002-0000-4000-8000-000000000002',
 'What, if anything, preceded the Big Bang?',
 'Whether the Big Bang was an absolute beginning or a transition from a prior state.',
 90,'unknown',
 'Options include eternal inflation, a bouncing cosmology, a cyclic universe, or a genuine initial singularity beyond which "before" is undefined.',
 'Inflation explains key features of the observable universe but does not by itself fix the initial state; quantum-gravity proposals remain untested.'),
('60000004-0000-4000-8000-000000000004','what-is-dark-matter','d0000001-0000-4000-8000-000000000001',
 'What is dark matter?',
 'About a quarter of the universe''s energy density behaves gravitationally like matter but emits no light. What is it?',
 88,'strong_evidence',
 'Leading candidates are new particles (WIMPs, axions). Alternatives modify gravity (MOND). Gravitational evidence for unseen mass is very strong; particle identification is not.',
 'Multiple independent lines (rotation curves, lensing, CMB) confirm the gravitational effect; direct-detection experiments have so far returned null results, tightening constraints.'),
('60000005-0000-4000-8000-000000000005','what-is-dark-energy','d0000002-0000-4000-8000-000000000002',
 'What is dark energy?',
 'The expansion of the universe is accelerating. What drives it?',
 88,'plausible',
 'A cosmological constant (vacuum energy) fits the data well, but its theoretically expected value is wrong by many orders of magnitude. Dynamical "quintessence" is an alternative.',
 'Acceleration is robustly observed; the cosmological constant problem and the Hubble tension signal that the underlying physics is not understood.'),
('60000006-0000-4000-8000-000000000006','quantum-measurement-problem','d0000004-0000-4000-8000-000000000004',
 'What happens during a quantum measurement?',
 'The smooth evolution of the wavefunction and the definite outcomes we observe sit uneasily together. What selects an outcome?',
 86,'unknown',
 'Interpretations differ radically: Copenhagen, many-worlds, pilot-wave, and objective-collapse all reproduce the predictions while disagreeing about what is real.',
 'Bell tests rule out local hidden variables; collapse models make testable deviations now being constrained, but no interpretation is empirically singled out.'),
('60000007-0000-4000-8000-000000000007','how-did-life-begin','d0000006-0000-4000-8000-000000000006',
 'How did life originate from non-living matter?',
 'The transition from prebiotic chemistry to a self-replicating, evolving system.',
 87,'plausible',
 'The RNA-world hypothesis proposes self-replicating RNA preceded DNA and proteins; metabolism-first and hydrothermal-vent scenarios compete.',
 'Prebiotic syntheses of nucleotides, amino acids and lipids are demonstrated, but a continuous laboratory path to a living cell has not been achieved.'),
('60000008-0000-4000-8000-000000000008','why-these-laws','d0000009-0000-4000-8000-000000000009',
 'Why does the universe obey these particular laws?',
 'Whether the specific laws and constants are necessary, accidental, or selected.',
 85,'unknown',
 'Possibilities: a unique self-consistent theory; environmental selection in a multiverse; or brute contingency. Each has difficulty being tested.',
 'String theory suggests an enormous landscape of possible vacua, which sharpens the question without yet answering it.'),
('60000009-0000-4000-8000-000000000009','is-universe-fine-tuned','d0000009-0000-4000-8000-000000000009',
 'Is the universe fine-tuned for life, and if so why?',
 'Several constants appear to lie in narrow ranges compatible with complexity and life. Is this significant?',
 80,'unknown',
 'Explanations: multiverse plus observer selection; deeper laws fixing the constants; design; or overstated tuning. The premise itself is debated.',
 'The cosmological constant''s smallness is the sharpest example; whether "tuning" is real or an artifact of our ignorance of the underlying theory is unsettled.'),
('6000000a-0000-4000-8000-00000000000a','is-math-discovered-or-invented','d0000005-0000-4000-8000-000000000005',
 'Is mathematics discovered or invented?',
 'Do mathematical truths exist independently of minds, or are they human constructions?',
 78,'unknown',
 'Platonism says discovered; formalism and intuitionism say constructed. The unreasonable effectiveness of mathematics in physics is cited by both sides.',
 'No empirical test distinguishes the positions; the debate proceeds through argument and the practice of mathematics and physics.'),
('6000000b-0000-4000-8000-00000000000b','arrow-of-time','d0000008-0000-4000-8000-000000000008',
 'Why does time have a direction?',
 'Microscopic physics is nearly time-symmetric, yet macroscopic processes are irreversible. Where does the arrow come from?',
 82,'plausible',
 'The standard account roots the arrow in the low entropy of the early universe (the "past hypothesis"), so the thermodynamic arrow follows from special initial conditions.',
 'The statistical-mechanical story is well developed; why the early universe had such low entropy is itself unexplained.'),
('6000000c-0000-4000-8000-00000000000c','is-time-fundamental','d0000008-0000-4000-8000-000000000008',
 'Is time fundamental or emergent?',
 'Whether time is a basic feature of reality or arises from a deeper timeless structure.',
 76,'unknown',
 'Some quantum-gravity approaches (e.g. the Wheeler–DeWitt equation) are timeless, with time emerging relationally; others keep time fundamental.',
 'No consensus quantum theory of gravity exists, so the status of time remains open.'),
('6000000d-0000-4000-8000-00000000000d','can-we-unify-physics','d0000001-0000-4000-8000-000000000001',
 'Can gravity and quantum mechanics be unified?',
 'General relativity and quantum field theory are each superbly tested but mutually incompatible in extreme regimes.',
 84,'unknown',
 'String theory and loop quantum gravity are leading programs; AdS/CFT provides a concrete instance of a gravity–quantum duality in special spacetimes.',
 'No experimentally confirmed theory of quantum gravity exists; the relevant energy scales are far beyond current experiments.'),
('6000000e-0000-4000-8000-00000000000e','is-information-fundamental','d0000007-0000-4000-8000-000000000007',
 'Is information a fundamental constituent of reality?',
 'Whether information is as basic as matter and energy — Wheeler''s "it from bit".',
 75,'unknown',
 'Black-hole thermodynamics and quantum-information reconstructions of quantum theory suggest information is deeply physical; critics see this as a useful framework, not an ontology.',
 'Active research links entanglement entropy to spacetime geometry, but "information is fundamental" is not an established result.'),
('6000000f-0000-4000-8000-00000000000f','are-we-alone','d0000010-0000-4000-8000-000000000010',
 'Are we alone in the universe?',
 'Whether life, and intelligent life, exists beyond Earth.',
 83,'unknown',
 'Estimates range from life being common to Earth being essentially unique. The Fermi paradox highlights the tension between vast opportunity and absent evidence.',
 'Exoplanet counts are now in the thousands and biosignature searches are beginning, but there is no detection of life beyond Earth.'),
('60000010-0000-4000-8000-000000000010','do-we-have-free-will','d0000003-0000-4000-8000-000000000003',
 'Is free will compatible with physical law?',
 'Whether deliberate agency can be reconciled with deterministic or probabilistic physics.',
 70,'unknown',
 'Compatibilists redefine free will to fit determinism; libertarians require genuine openness; hard determinists deny free will. Quantum indeterminacy does not obviously help.',
 'Neuroscience experiments on the timing of decisions are suggestive but contested and do not settle the metaphysics.'),
('60000011-0000-4000-8000-000000000011','what-is-the-fate-of-the-universe','d0000002-0000-4000-8000-000000000002',
 'What is the ultimate fate of the universe?',
 'Whether the universe ends in heat death, a big rip, a collapse, or something else.',
 72,'plausible',
 'Under a cosmological constant, accelerated expansion leads to an asymptotically cold, empty, high-entropy state ("heat death"). Alternatives depend on dark energy''s true nature.',
 'The fate hinges on the equation of state of dark energy, which is measured only approximately.'),
('60000012-0000-4000-8000-000000000012','is-reality-fundamentally-continuous','d0000001-0000-4000-8000-000000000001',
 'Is spacetime continuous or discrete?',
 'Whether space and time are smooth at every scale or have a smallest grain near the Planck length.',
 68,'unknown',
 'Loop quantum gravity suggests discreteness; string theory keeps a continuum with a minimal length scale; the question is tied to quantum gravity.',
 'No experiment yet probes the Planck scale directly; some astrophysical tests constrain certain discreteness models.'),
('60000013-0000-4000-8000-000000000013','does-objective-reality-exist','d0000004-0000-4000-8000-000000000004',
 'Does an observer-independent reality exist?',
 'Whether physical properties have definite values independent of measurement.',
 74,'unknown',
 'Realist interpretations affirm an observer-independent world; some readings of quantum theory (e.g. QBism, relational QM) make outcomes observer-relative.',
 'Bell and related no-go theorems constrain which realist pictures are viable, ruling out local hidden variables, but do not eliminate realism as such.'),
('60000014-0000-4000-8000-000000000014','why-is-the-universe-comprehensible','d0000005-0000-4000-8000-000000000005',
 'Why is the universe comprehensible to us at all?',
 'Why human cognition, evolved for ordinary survival, can grasp deep physical law.',
 66,'unknown',
 'Suggested answers range from selection effects and the universality of mathematics to the view that comprehensibility is partly projected by our theories.',
 'A largely philosophical question, informed by the historical success of mathematical physics.')
on conflict (id) do nothing;

-- ─── Evidence (~30 entries) ──────────────────────────────────────────────────

insert into evidence (id, slug, title, summary, source_id, strength, domain_id) values
('e0000001-0000-4000-8000-000000000001','cmb-power-spectrum','Cosmic microwave background power spectrum',
 'Planck''s precise measurement of CMB temperature anisotropies matches the six-parameter ΛCDM model, fixing the universe''s age, geometry, and composition (~5% ordinary matter, ~27% dark matter, ~68% dark energy).',
 '50000001-0000-4000-8000-000000000001',92,'d0000002-0000-4000-8000-000000000002'),
('e0000002-0000-4000-8000-000000000002','bullet-cluster-lensing','Bullet Cluster: mass and gas are spatially separated',
 'Weak-lensing mass maps of colliding clusters show the gravitational mass leading the X-ray-emitting gas, hard to explain if all mass is the visible baryons — strong evidence for collisionless dark matter.',
 '50000002-0000-4000-8000-000000000002',86,'d0000001-0000-4000-8000-000000000001'),
('e0000003-0000-4000-8000-000000000003','galaxy-rotation-curves','Flat galaxy rotation curves',
 'Rotation velocities stay flat far from galactic centers instead of falling off, implying either unseen mass or a departure from Newtonian dynamics at low accelerations.',
 '50000017-0000-4000-8000-000000000017',82,'d0000001-0000-4000-8000-000000000001'),
('e0000004-0000-4000-8000-000000000004','supernova-acceleration','Type Ia supernovae show accelerating expansion',
 'Distant standard-candle supernovae are dimmer than expected in a decelerating universe, evidence that cosmic expansion is accelerating — attributed to dark energy.',
 '50000003-0000-4000-8000-000000000003',88,'d0000002-0000-4000-8000-000000000002'),
('e0000005-0000-4000-8000-000000000005','cosmological-constant-problem','The cosmological constant problem',
 'The vacuum energy predicted by quantum field theory exceeds the observed dark-energy density by many tens of orders of magnitude — a profound mismatch with any naive calculation.',
 '50000014-0000-4000-8000-000000000014',80,'d0000002-0000-4000-8000-000000000002'),
('e0000006-0000-4000-8000-000000000006','lz-null-result','LUX-ZEPLIN direct-detection null result',
 'The most sensitive WIMP dark-matter search to date reports no signal, excluding large regions of candidate parameter space and constraining the simplest particle models.',
 '5000001b-0000-4000-8000-00000000001b',72,'d0000001-0000-4000-8000-000000000001'),
('e0000007-0000-4000-8000-000000000007','mond-galaxy-scaling','MOND fits galactic dynamics with one parameter',
 'A single acceleration scale reproduces many galaxy rotation curves without dark matter, a regularity (the radial-acceleration relation) that pure-particle dark matter must explain separately.',
 '50000019-0000-4000-8000-000000000019',60,'d0000001-0000-4000-8000-000000000001'),
('e0000008-0000-4000-8000-000000000008','bell-aspect','Aspect experiments violate Bell inequalities',
 'Measured correlations between entangled photons violate Bell inequalities, ruling out local hidden-variable explanations of quantum correlations.',
 '50000006-0000-4000-8000-000000000006',90,'d0000004-0000-4000-8000-000000000004'),
('e0000009-0000-4000-8000-000000000009','loophole-free-bell','Loophole-free Bell test',
 'A 1.3 km electron-spin experiment closed the detection and locality loopholes simultaneously, confirming Bell violations under the strictest conditions.',
 '50000007-0000-4000-8000-000000000007',93,'d0000004-0000-4000-8000-000000000004'),
('e000000a-0000-4000-8000-00000000000a','epr-argument','EPR argument for incompleteness',
 'Einstein, Podolsky and Rosen argued that quantum mechanics is either incomplete or permits "spooky" nonlocal influence, framing the debate later settled empirically by Bell tests.',
 '50000011-0000-4000-8000-000000000011',70,'d0000004-0000-4000-8000-000000000004'),
('e000000b-0000-4000-8000-00000000000b','hard-problem-argument','The explanatory-gap argument',
 'Chalmers argues that functional and physical explanations address the "easy problems" but leave unexplained why those processes are accompanied by subjective experience.',
 '50000004-0000-4000-8000-000000000004',62,'d0000003-0000-4000-8000-000000000003'),
('e000000c-0000-4000-8000-00000000000c','neural-correlates','Neural correlates of consciousness',
 'Specific, manipulable neural activity reliably tracks the contents of conscious experience, supporting a tight dependence of mind on brain.',
 '50000013-0000-4000-8000-000000000013',74,'d0000003-0000-4000-8000-000000000003'),
('e000000d-0000-4000-8000-00000000000d','iit-formal','Integrated Information Theory',
 'IIT proposes that consciousness corresponds to integrated information (Φ) in a system, yielding quantitative, in-principle-testable predictions about which systems are conscious.',
 '5000001a-0000-4000-8000-00000000001a',58,'d0000003-0000-4000-8000-000000000003'),
('e000000e-0000-4000-8000-00000000000e','astonishing-hypothesis','The physical basis of mind (Crick)',
 'Crick''s programmatic claim that mental states are wholly the behaviour of neurons motivates a reductive, physicalist research program for consciousness.',
 '50000012-0000-4000-8000-000000000012',55,'d0000003-0000-4000-8000-000000000003'),
('e000000f-0000-4000-8000-00000000000f','wigner-effectiveness','The unreasonable effectiveness of mathematics',
 'Wigner observes that abstract mathematics developed for its own sake repeatedly turns out to describe physical reality with uncanny precision.',
 '50000008-0000-4000-8000-000000000008',60,'d0000005-0000-4000-8000-000000000005'),
('e0000010-0000-4000-8000-000000000010','tegmark-muh','The Mathematical Universe Hypothesis',
 'Tegmark proposes that physical reality is a mathematical structure, implying the effectiveness of mathematics is definitional rather than mysterious.',
 '50000009-0000-4000-8000-000000000009',30,'d0000005-0000-4000-8000-000000000005'),
('e0000011-0000-4000-8000-000000000011','miller-urey','Miller–Urey amino-acid synthesis',
 'A spark discharge through a reducing gas mixture produced amino acids, showing biologically relevant molecules can form from simple precursors under plausible early-Earth conditions.',
 '5000000a-0000-4000-8000-00000000000a',78,'d0000006-0000-4000-8000-000000000006'),
('e0000012-0000-4000-8000-000000000012','powner-nucleotides','Prebiotic synthesis of activated ribonucleotides',
 'Powner et al. synthesized activated pyrimidine ribonucleotides via a route bypassing free ribose and base, a major boost to the plausibility of an RNA-world origin.',
 '5000000b-0000-4000-8000-00000000000b',76,'d0000006-0000-4000-8000-000000000006'),
('e0000013-0000-4000-8000-000000000013','bekenstein-entropy','Black-hole entropy is proportional to area',
 'Bekenstein argued black holes carry entropy proportional to their horizon area, tying gravity, thermodynamics, and information together.',
 '5000000c-0000-4000-8000-00000000000c',82,'d0000007-0000-4000-8000-000000000007'),
('e0000014-0000-4000-8000-000000000014','hawking-radiation','Hawking radiation',
 'Hawking showed black holes radiate thermally, confirming they are thermodynamic objects with a temperature and entropy and raising the information-loss puzzle.',
 '5000000d-0000-4000-8000-00000000000d',80,'d0000007-0000-4000-8000-000000000007'),
('e0000015-0000-4000-8000-000000000015','adscft-duality','AdS/CFT holographic duality',
 'Maldacena''s duality equates a gravitational theory in a volume with a non-gravitational quantum theory on its boundary, a concrete realization of the holographic principle.',
 '5000000f-0000-4000-8000-00000000000f',74,'d0000007-0000-4000-8000-000000000007'),
('e0000016-0000-4000-8000-000000000016','verlinde-entropic','Entropic / emergent gravity',
 'Verlinde proposes gravity is not fundamental but an entropic force arising from information associated with the positions of matter — a speculative but explicit emergence proposal.',
 '50000010-0000-4000-8000-000000000010',34,'d0000001-0000-4000-8000-000000000001'),
('e0000017-0000-4000-8000-000000000017','singularity-theorems','Singularity theorems',
 'Penrose–Hawking theorems show that, under general conditions, general relativity predicts spacetime singularities — a beginning or boundary where the classical theory breaks down.',
 '5000000e-0000-4000-8000-00000000000e',78,'d0000002-0000-4000-8000-000000000002'),
('e0000018-0000-4000-8000-000000000018','inflation-proposal','Cosmic inflation',
 'Guth''s inflationary epoch of rapid early expansion explains the universe''s flatness, homogeneity, and the absence of relics, and seeds structure from quantum fluctuations.',
 '50000015-0000-4000-8000-000000000015',72,'d0000002-0000-4000-8000-000000000002'),
('e0000019-0000-4000-8000-000000000019','planck-inflation-constraints','Planck constraints on inflation',
 'Planck''s measurements of the primordial spectrum are consistent with simple inflation and disfavor many specific models, while not uniquely confirming inflation itself.',
 '50000016-0000-4000-8000-000000000016',70,'d0000002-0000-4000-8000-000000000002'),
('e000001a-0000-4000-8000-00000000001a','hubble-tension','The Hubble tension',
 'Local distance-ladder measurements of the expansion rate disagree with the value inferred from the CMB at high significance, hinting at unknown physics or systematics.',
 '50000018-0000-4000-8000-000000000018',68,'d0000002-0000-4000-8000-000000000002'),
('e000001b-0000-4000-8000-00000000001b','pessimistic-induction','The pessimistic meta-induction',
 'Laudan notes that many past successful theories were later judged false, cautioning against inferring that our current best theories are true descriptions of reality.',
 '5000001d-0000-4000-8000-00000000001d',56,'d0000005-0000-4000-8000-000000000005'),
('e000001c-0000-4000-8000-00000000001c','it-from-bit','Wheeler''s "it from bit"',
 'Wheeler proposes that every physical entity derives its existence from binary, information-theoretic answers to yes/no questions — information as the ground of physics.',
 '5000001c-0000-4000-8000-00000000001c',40,'d0000007-0000-4000-8000-000000000007'),
('e000001d-0000-4000-8000-00000000001d','orch-or','Penrose: non-computable physics in the mind',
 'Penrose argues that human mathematical insight exceeds any algorithm, suggesting consciousness involves physics beyond standard computation — a much-criticized proposal.',
 '5000001e-0000-4000-8000-00000000001e',26,'d0000003-0000-4000-8000-000000000003'),
('e000001e-0000-4000-8000-00000000001e','jwst-early-galaxies','JWST observations of the early universe',
 'JWST has revealed surprisingly bright, mature galaxies at very high redshift, probing the first hundreds of millions of years and testing models of structure formation.',
 '5000001f-0000-4000-8000-00000000001f',72,'d0000002-0000-4000-8000-000000000002'),
('e000001f-0000-4000-8000-00000000001f','time-symmetry-microphysics','Time symmetry of microphysical law',
 'Fundamental dynamical laws are (nearly) invariant under time reversal, so the macroscopic arrow of time cannot come from the dynamics alone and must be sought in boundary conditions.',
 '5000000e-0000-4000-8000-00000000000e',76,'d0000008-0000-4000-8000-000000000008')
on conflict (id) do nothing;

-- ─── Hypotheses (~15, spanning the taxonomy) ─────────────────────────────────
-- Honest confidence: deep metaphysics sits in unknown/speculation (≤40);
-- only well-supported background physics rises into plausible/strong bands.

insert into hypotheses (id, slug, domain_id, question_id, title, description, status, state, confidence, confidence_rationale, assumptions, open_questions, falsification_criteria) values

('a0000001-0000-4000-8000-000000000001','reality-is-fundamentally-physical','d0000009-0000-4000-8000-000000000009','60000002-0000-4000-8000-000000000002',
 'Reality is fundamentally physical',
 'All that exists is physical, and every phenomenon — including mind — is ultimately constituted by physical processes described (in principle) by physics.',
 'plausible','active',38,
 'Physicalism is the most economical reading of an extraordinarily successful physical science, but the hard problem of consciousness and the interpretation of quantum mechanics leave a genuine gap, so confidence stays in the lower plausible band rather than higher.',
 '[{"text":"A complete physics is possible in principle","justified":false,"notes":"We do not have one; quantum gravity is missing."},{"text":"Subjective experience is physically constitutable","justified":false,"notes":"This is exactly what the hard problem disputes."}]',
 '[{"text":"Can physicalism account for the qualitative character of experience?"},{"text":"Does the measurement problem require non-physical ingredients? (Most say no.)"}]',
 'A demonstrated phenomenon that resists any physical description even in principle — e.g. a rigorously established mental effect with no physical correlate — would falsify it.'),

('a0000002-0000-4000-8000-000000000002','consciousness-is-non-reducible','d0000003-0000-4000-8000-000000000003','60000002-0000-4000-8000-000000000002',
 'Consciousness is not reducible to physical processes',
 'Subjective experience is a basic feature of reality not fully explained by, or derivable from, physical facts about the brain.',
 'speculation','active',28,
 'The explanatory-gap and conceivability arguments are serious and unresolved, but non-reductive views struggle to connect to the detailed dependence of mind on brain, so this remains speculation rather than a plausible hypothesis.',
 '[{"text":"A complete physical description would still leave experience unexplained","justified":false,"notes":"Intuition-driven; contested."},{"text":"Conceivability of zombies implies their possibility","justified":false}]',
 '[{"text":"What is the relation between non-reducible experience and neural dynamics?"},{"text":"Can the view make any novel empirical prediction?"}]',
 'A successful reductive explanation that predicts the presence and character of experience from physical facts alone would undercut it.'),

('a0000003-0000-4000-8000-000000000003','consciousness-is-integrated-information','d0000003-0000-4000-8000-000000000003','60000002-0000-4000-8000-000000000002',
 'Consciousness is integrated information (IIT)',
 'A system is conscious to the degree that it possesses integrated information (Φ); experience is identical to a maximally irreducible cause–effect structure.',
 'speculation','active',26,
 'IIT is admirably precise and predictive, but computing Φ at scale is intractable, some predictions are counterintuitive (e.g. simple grids being conscious), and key claims remain empirically untested, so confidence is low.',
 '[{"text":"Integrated information is necessary and sufficient for experience","justified":false},{"text":"Φ is well-defined and measurable for real systems","justified":false,"notes":"Currently intractable at scale."}]',
 '[{"text":"Do high-Φ but behaviorally inert systems have experience?"},{"text":"Can Φ be estimated for biological brains?"}]',
 'Finding conscious systems with low Φ, or convincingly unconscious systems with high Φ, would falsify the identity claim.'),

('a0000004-0000-4000-8000-000000000004','information-is-fundamental','d0000007-0000-4000-8000-000000000007','6000000e-0000-4000-8000-00000000000e',
 'Information is a fundamental constituent of reality',
 'Information is not merely a description of physical systems but an irreducible ingredient from which physical reality is built ("it from bit").',
 'speculation','active',30,
 'Black-hole thermodynamics and quantum-information reconstructions make information look physically deep, but treating it as ontologically fundamental is a research program rather than a confirmed result; confidence held in the speculation band.',
 '[{"text":"Information can exist without a physical substrate","justified":false,"notes":"Highly contested; arguably incoherent."},{"text":"Holographic bounds reflect an information ontology","justified":false}]',
 '[{"text":"What carries the information if not matter/energy?"},{"text":"Is this an ontology or a useful formalism?"}]',
 'A demonstration that information-theoretic structure is always derivative of more basic physical degrees of freedom would falsify the strong claim.'),

('a0000005-0000-4000-8000-000000000005','spacetime-is-emergent','d0000001-0000-4000-8000-000000000001','6000000d-0000-4000-8000-00000000000d',
 'Spacetime is emergent, not fundamental',
 'Space and time are not basic but arise from a deeper, possibly information- or entanglement-based structure; gravity is a thermodynamic/emergent phenomenon.',
 'speculation','active',32,
 'AdS/CFT and entanglement-geometry results give concrete, technically serious support in special settings, but there is no background-independent, experimentally tested theory, so this stays speculative.',
 '[{"text":"The holographic principle generalizes beyond AdS","justified":false},{"text":"Entanglement builds geometry","justified":false,"notes":"Demonstrated only in toy models."}]',
 '[{"text":"What are the pre-geometric degrees of freedom?"},{"text":"Does emergence hold for our (non-AdS) universe?"}]',
 'A confirmed quantum theory of gravity in which spacetime is irreducibly fundamental would falsify it.'),

('a0000006-0000-4000-8000-000000000006','universe-is-mathematical','d0000005-0000-4000-8000-000000000005','6000000a-0000-4000-8000-00000000000a',
 'The universe is a mathematical structure (MUH)',
 'Physical reality is not merely described by mathematics but is a mathematical structure; all consistent structures exist and physical existence is mathematical existence.',
 'speculation','active',18,
 'The MUH elegantly dissolves the effectiveness-of-mathematics puzzle, but it is extremely hard to test, faces the measure problem, and many regard it as unfalsifiable; confidence is deliberately very low.',
 '[{"text":"Physical existence equals mathematical existence","justified":false},{"text":"All consistent mathematical structures are equally real","justified":false}]',
 '[{"text":"How is a probability measure defined over structures?"},{"text":"Is the hypothesis falsifiable at all?"}]',
 'A demonstrated physical fact with no possible mathematical representation, or a principled reason the identification fails, would falsify it.'),

('a0000007-0000-4000-8000-000000000007','reality-fundamentally-emergent','d0000009-0000-4000-8000-000000000009','60000008-0000-4000-8000-000000000008',
 'Fundamental reality is emergent all the way down',
 'There is no ultimate bottom level; what we call "fundamental" is always an effective description of deeper structure, with no final layer of brute facts.',
 'speculation','active',22,
 'Effective field theory shows physics is layered, which makes open-ended emergence conceivable, but "no fundamental level" is a strong metaphysical claim with no decisive evidence; held as speculation.',
 '[{"text":"Every level has a deeper underlying level","justified":false,"notes":"Cannot be established empirically."}]',
 '[{"text":"Is an infinite descent of levels coherent?"},{"text":"How would we ever know we had reached bottom?"}]',
 'Discovery of a demonstrably final, complete fundamental theory with no deeper structure would falsify it.'),

('a0000008-0000-4000-8000-000000000008','dark-matter-is-new-particle','d0000001-0000-4000-8000-000000000001','60000004-0000-4000-8000-000000000004',
 'Dark matter is a new fundamental particle',
 'The gravitational anomalies attributed to dark matter are caused by an as-yet-undetected, weakly-interacting massive particle (or similar) beyond the Standard Model.',
 'plausible','active',55,
 'Multiple independent gravitational probes (CMB, lensing, clusters) are well fit by cold, collisionless matter, strongly favoring a particle; but repeated direct-detection null results keep this from reaching the strong-evidence band.',
 '[{"text":"The anomalies are due to matter, not modified gravity","justified":true,"notes":"Bullet Cluster strongly supports this."},{"text":"The particle interacts weakly enough to have evaded detection","justified":false}]',
 '[{"text":"Why have direct searches seen nothing?"},{"text":"Can it explain galactic scaling relations as well as MOND does?"}]',
 'A confirmed detection of a dark-matter particle would raise confidence; a compelling, fully predictive modified-gravity theory matching all cosmological data without dark matter would falsify it.'),

('a0000009-0000-4000-8000-000000000009','dark-matter-is-modified-gravity','d0000001-0000-4000-8000-000000000001','60000004-0000-4000-8000-000000000004',
 'There is no dark matter; gravity is modified (MOND)',
 'The observed anomalies reflect a breakdown of Newtonian/Einsteinian gravity at low accelerations rather than unseen mass.',
 'speculation','active',20,
 'MOND captures galactic dynamics with a single parameter remarkably well, but it struggles with clusters, the CMB, and the Bullet Cluster without adding dark matter of its own, so confidence is low.',
 '[{"text":"A relativistic completion of MOND can fit cosmology","justified":false},{"text":"The Bullet Cluster can be explained without dark matter","justified":false,"notes":"This is the strongest objection."}]',
 '[{"text":"How to fit the CMB power spectrum?"},{"text":"What is the covariant theory?"}]',
 'The clean separation of mass and gas in colliding clusters, and the CMB acoustic peaks, are strong evidence against it; a confirmed dark-matter particle would falsify it.'),

('a000000a-0000-4000-8000-00000000000a','dark-energy-is-cosmological-constant','d0000002-0000-4000-8000-000000000002','60000005-0000-4000-8000-000000000005',
 'Dark energy is a cosmological constant',
 'Cosmic acceleration is driven by a constant vacuum energy density (Λ), the simplest addition to general relativity consistent with the data.',
 'plausible','active',52,
 'A cosmological constant fits the supernova, CMB, and large-scale-structure data economically, but the enormous theoretical mismatch in its value and the emerging Hubble tension keep confidence only modestly above the midpoint.',
 '[{"text":"Dark energy density is constant in time","justified":false,"notes":"Consistent with data but not proven."},{"text":"General relativity is correct on cosmological scales","justified":true}]',
 '[{"text":"Why is Λ so small but nonzero?"},{"text":"Does the Hubble tension signal new physics?"}]',
 'A measured time-variation in the dark-energy equation of state (w ≠ −1) would falsify the pure cosmological-constant model.'),

('a000000b-0000-4000-8000-00000000000b','life-began-rna-world','d0000006-0000-4000-8000-000000000006','60000007-0000-4000-8000-000000000007',
 'Life began in an RNA world',
 'Self-replicating RNA molecules, acting as both genetic material and catalyst, preceded DNA and proteins and bootstrapped the first evolving systems.',
 'plausible','active',45,
 'Prebiotic synthesis of activated ribonucleotides and the catalytic competence of RNA (ribozymes, the ribosome) make the RNA world the leading scenario, but no self-sustaining RNA replicator has been demonstrated, so confidence sits mid-band.',
 '[{"text":"RNA can both store information and catalyze its own replication","justified":false,"notes":"Partially shown; full self-replication not yet achieved."},{"text":"Prebiotic chemistry could supply enough RNA","justified":false}]',
 '[{"text":"How did the first RNA replicator arise?"},{"text":"Was metabolism first instead?"}]',
 'Demonstrating a viable metabolism-first pathway, or showing RNA self-replication is prebiotically impossible, would weaken or falsify it.'),

('a000000c-0000-4000-8000-00000000000c','cosmic-inflation-occurred','d0000002-0000-4000-8000-000000000002','60000003-0000-4000-8000-000000000003',
 'The early universe underwent cosmic inflation',
 'A brief epoch of exponential expansion in the first fraction of a second explains the universe''s flatness, homogeneity, and the origin of structure.',
 'plausible','active',58,
 'Inflation accounts for several otherwise-unrelated observations and its predicted near-scale-invariant fluctuations match Planck data, but a direct signature (primordial B-mode gravitational waves) is undetected and alternatives survive, so it stays in the upper plausible band.',
 '[{"text":"A suitable inflaton field exists","justified":false},{"text":"Planck data favor inflation over alternatives","justified":true,"notes":"Consistent with simple models."}]',
 '[{"text":"What is the inflaton?"},{"text":"Will primordial gravitational waves be detected?"}]',
 'Detection of primordial B-mode polarization would strongly confirm it; a robust observation incompatible with inflationary predictions, or a better-fitting bounce model, would falsify it.'),

('a000000d-0000-4000-8000-00000000000d','many-worlds-interpretation','d0000004-0000-4000-8000-000000000004','60000006-0000-4000-8000-000000000006',
 'Quantum measurement: the many-worlds interpretation',
 'The wavefunction never collapses; all measurement outcomes occur, each in a separate branch of a continually splitting universal wavefunction.',
 'speculation','active',24,
 'Many-worlds takes the unitary formalism at face value and removes the measurement problem''s special collapse, but deriving the Born-rule probabilities and making sense of "branch counting" remain contested, and it is empirically indistinguishable from rivals, so confidence is low.',
 '[{"text":"The universal wavefunction is the complete description","justified":false},{"text":"The Born rule can be derived from branching","justified":false,"notes":"Contested."}]',
 '[{"text":"Where do probabilities come from if everything happens?"},{"text":"Is the interpretation empirically distinguishable?"}]',
 'Any confirmed objective collapse (a measurable deviation from unitary evolution) would falsify it.'),

('a000000e-0000-4000-8000-00000000000e','time-is-emergent','d0000008-0000-4000-8000-000000000008','6000000c-0000-4000-8000-00000000000c',
 'Time is emergent, not fundamental',
 'Time is not a basic ingredient of reality but emerges relationally from a deeper timeless structure, as in the timeless Wheeler–DeWitt formulation of quantum gravity.',
 'speculation','active',25,
 'Timeless formulations of quantum gravity and relational accounts of time are mathematically serious, but there is no tested quantum theory of gravity and the macroscopic arrow of time is unexplained, so this stays speculative.',
 '[{"text":"A timeless quantum-gravity description is correct","justified":false},{"text":"Time can emerge from correlations alone","justified":false,"notes":"Shown only in toy models."}]',
 '[{"text":"How does the experienced flow of time emerge?"},{"text":"How is the past hypothesis explained?"}]',
 'A confirmed theory of quantum gravity in which time is irreducibly fundamental would falsify it.'),

('a000000f-0000-4000-8000-00000000000f','life-is-common-in-universe','d0000010-0000-4000-8000-000000000010','6000000f-0000-4000-8000-00000000000f',
 'Microbial life is common in the universe',
 'Given the ubiquity of organic chemistry, liquid water, and habitable environments, simple life arises readily and is widespread, even if intelligence is rare.',
 'speculation','active',30,
 'The rapid appearance of life on early Earth and the abundance of habitable-zone exoplanets are suggestive, but with a single example of life and no detection elsewhere, any abundance estimate is barely constrained; confidence kept low.',
 '[{"text":"Earth''s early biogenesis is representative","justified":false,"notes":"n = 1."},{"text":"Habitable environments reliably produce life","justified":false}]',
 '[{"text":"What is the true probability of abiogenesis?"},{"text":"Why no biosignatures detected yet?"}]',
 'A confirmed independent origin of life elsewhere would raise confidence sharply; an exhaustive null result across many habitable worlds would lower it.')
on conflict (id) do nothing;

-- ─── Evidence ↔ hypothesis links (supportive AND oppositional) ───────────────
-- Several evidence items are linked to competing hypotheses with opposite
-- relations so scan_contradictions() finds non-trivial evidential conflicts.

insert into hypothesis_evidence (hypothesis_id, evidence_id, relation, weight, notes) values
-- Physicalism vs non-reducibility (share the same evidence, opposite relations)
('a0000001-0000-4000-8000-000000000001','e000000c-0000-4000-8000-00000000000c','supports',75,'Tight, manipulable mind–brain dependence is what physicalism predicts.'),
('a0000001-0000-4000-8000-000000000001','e000000e-0000-4000-8000-00000000000e','supports',60,'A reductive neuroscience program presupposes physicalism.'),
('a0000001-0000-4000-8000-000000000001','e000000b-0000-4000-8000-00000000000b','opposes',65,'The explanatory gap is the central challenge to physicalism.'),
('a0000002-0000-4000-8000-000000000002','e000000b-0000-4000-8000-00000000000b','supports',70,'The explanatory-gap argument is the core case for non-reducibility.'),
('a0000002-0000-4000-8000-000000000002','e000000c-0000-4000-8000-00000000000c','opposes',70,'Strong neural dependence pressures non-reductive views.'),
('a0000002-0000-4000-8000-000000000002','e000001d-0000-4000-8000-00000000001d','supports',25,'Penrose''s non-computability claim, if right, supports non-reducibility (weakly; widely criticized).'),

-- IIT
('a0000003-0000-4000-8000-000000000003','e000000d-0000-4000-8000-00000000000d','supports',70,'IIT is the formal statement of this hypothesis.'),
('a0000003-0000-4000-8000-000000000003','e000000c-0000-4000-8000-00000000000c','supports',40,'Neural correlates are broadly consistent with integration measures.'),
('a0000003-0000-4000-8000-000000000003','e000000e-0000-4000-8000-00000000000e','opposes',35,'A purely neuronal reductive program need not invoke Φ.'),

-- Information fundamental / spacetime emergent / it-from-bit network
('a0000004-0000-4000-8000-000000000004','e000001c-0000-4000-8000-00000000001c','supports',55,'"It from bit" is the canonical statement of this view.'),
('a0000004-0000-4000-8000-000000000004','e0000013-0000-4000-8000-000000000013','supports',55,'Black-hole entropy ties information to physical area.'),
('a0000004-0000-4000-8000-000000000004','e0000015-0000-4000-8000-000000000015','supports',50,'Holographic duality is read as evidence for an information substrate.'),
('a0000005-0000-4000-8000-000000000005','e0000015-0000-4000-8000-000000000015','supports',65,'AdS/CFT is the strongest concrete case for emergent spacetime.'),
('a0000005-0000-4000-8000-000000000005','e0000013-0000-4000-8000-000000000013','supports',45,'Horizon thermodynamics suggests geometry has a statistical origin.'),
('a0000005-0000-4000-8000-000000000005','e0000016-0000-4000-8000-000000000016','supports',30,'Entropic-gravity proposals model gravity as emergent.'),
('a0000005-0000-4000-8000-000000000005','e0000014-0000-4000-8000-000000000014','supports',25,'Hawking radiation reinforces gravity''s thermodynamic character.'),

-- Mathematical universe
('a0000006-0000-4000-8000-000000000006','e0000010-0000-4000-8000-000000000010','supports',60,'The MUH is the hypothesis this evidence states.'),
('a0000006-0000-4000-8000-000000000006','e000000f-0000-4000-8000-00000000000f','supports',45,'The effectiveness of mathematics is the MUH''s main motivation.'),
('a0000006-0000-4000-8000-000000000006','e000001b-0000-4000-8000-00000000001b','opposes',40,'The pessimistic meta-induction cautions against reifying current theory.'),

-- Math discovered: effectiveness supports realism but pessimistic induction opposes
('a0000007-0000-4000-8000-000000000007','e0000013-0000-4000-8000-000000000013','supports',20,'Layered effective descriptions motivate open-ended emergence (weak).'),

-- Dark matter particle vs MOND — strongest contradiction pair, shared evidence
('a0000008-0000-4000-8000-000000000008','e0000001-0000-4000-8000-000000000001','supports',80,'CMB acoustic peaks require cold dark matter.'),
('a0000008-0000-4000-8000-000000000008','e0000002-0000-4000-8000-000000000002','supports',82,'Bullet Cluster mass–gas separation is hard to explain without dark matter.'),
('a0000008-0000-4000-8000-000000000008','e0000003-0000-4000-8000-000000000003','supports',55,'Flat rotation curves are the original evidence for unseen mass.'),
('a0000008-0000-4000-8000-000000000008','e0000006-0000-4000-8000-000000000006','opposes',45,'Repeated direct-detection nulls disfavor the simplest particle models.'),
('a0000008-0000-4000-8000-000000000008','e0000007-0000-4000-8000-000000000007','opposes',35,'MOND''s single-parameter success is a regularity particles must explain separately.'),
('a0000009-0000-4000-8000-000000000009','e0000003-0000-4000-8000-000000000003','supports',50,'Flat rotation curves can be read as modified dynamics.'),
('a0000009-0000-4000-8000-000000000009','e0000007-0000-4000-8000-000000000007','supports',60,'The radial-acceleration relation is MOND''s strongest evidence.'),
('a0000009-0000-4000-8000-000000000009','e0000002-0000-4000-8000-000000000002','opposes',80,'The Bullet Cluster is the strongest evidence against pure modified gravity.'),
('a0000009-0000-4000-8000-000000000009','e0000001-0000-4000-8000-000000000001','opposes',75,'The CMB peaks are very hard for MOND without adding dark matter.'),

-- Dark energy = cosmological constant
('a000000a-0000-4000-8000-00000000000a','e0000004-0000-4000-8000-000000000004','supports',70,'Supernova acceleration is the direct evidence for dark energy.'),
('a000000a-0000-4000-8000-00000000000a','e0000001-0000-4000-8000-000000000001','supports',55,'ΛCDM fits the CMB with a cosmological constant.'),
('a000000a-0000-4000-8000-00000000000a','e0000005-0000-4000-8000-000000000005','opposes',60,'The cosmological-constant problem is a deep theoretical strike against a naive Λ.'),
('a000000a-0000-4000-8000-00000000000a','e000001a-0000-4000-8000-00000000001a','opposes',40,'The Hubble tension may indicate the simple Λ model is incomplete.'),

-- RNA world
('a000000b-0000-4000-8000-00000000000b','e0000012-0000-4000-8000-000000000012','supports',72,'Prebiotic ribonucleotide synthesis boosts RNA-world plausibility.'),
('a000000b-0000-4000-8000-00000000000b','e0000011-0000-4000-8000-000000000011','supports',45,'Miller–Urey shows building blocks form readily (supports abiogenesis generally).'),

-- Inflation
('a000000c-0000-4000-8000-00000000000c','e0000018-0000-4000-8000-000000000018','supports',65,'Inflation is the hypothesis; this is its proposal.'),
('a000000c-0000-4000-8000-00000000000c','e0000019-0000-4000-8000-000000000019','supports',60,'Planck data are consistent with simple inflation.'),
('a000000c-0000-4000-8000-00000000000c','e0000017-0000-4000-8000-000000000017','supports',30,'Singularity theorems motivate seeking a pre-classical epoch like inflation.'),
('a000000c-0000-4000-8000-00000000000c','e000001e-0000-4000-8000-00000000001e','opposes',30,'JWST''s early mature galaxies stress-test structure-formation timelines.'),

-- Many-worlds
('a000000d-0000-4000-8000-00000000000d','e0000008-0000-4000-8000-000000000008','supports',45,'Bell violations push against local hidden variables, consistent with unitary QM.'),
('a000000d-0000-4000-8000-00000000000d','e0000009-0000-4000-8000-000000000009','supports',45,'The loophole-free Bell test reinforces taking the wavefunction seriously.'),
('a000000d-0000-4000-8000-00000000000d','e000000a-0000-4000-8000-00000000000a','opposes',25,'EPR''s incompleteness worry motivates rival hidden-variable readings.'),

-- Time emergent
('a000000e-0000-4000-8000-00000000000e','e0000015-0000-4000-8000-000000000015','supports',45,'Holographic dualities make emergent-time scenarios concrete.'),
('a000000e-0000-4000-8000-00000000000e','e000001f-0000-4000-8000-00000000001f','supports',40,'Time-symmetric microphysics suggests time''s arrow is not fundamental.'),

-- Life common
('a000000f-0000-4000-8000-00000000000f','e0000011-0000-4000-8000-000000000011','supports',40,'Easy formation of building blocks is suggestive of common abiogenesis.'),
('a000000f-0000-4000-8000-00000000000f','e0000012-0000-4000-8000-000000000012','supports',35,'Plausible nucleotide synthesis supports life arising readily.')
on conflict (hypothesis_id, evidence_id) do nothing;

-- ─── Graph edges: explicit logical relations beyond the auto-generated ones ───
-- The evidence-link trigger already created evidence→hypothesis edges. Add the
-- declared logical contradiction between the two dark-matter hypotheses so the
-- graph shows a 'contradicts' edge and the scan has a logical pair too.

insert into graph_edges (from_type, from_id, to_type, to_id, edge) values
('hypothesis','a0000008-0000-4000-8000-000000000008','hypothesis','a0000009-0000-4000-8000-000000000009','contradicts'),
('hypothesis','a0000001-0000-4000-8000-000000000001','hypothesis','a0000002-0000-4000-8000-000000000002','contradicts'),
('hypothesis','a000000d-0000-4000-8000-00000000000d','question','60000006-0000-4000-8000-000000000006','derived_from')
on conflict do nothing;

-- ─── Research notes ──────────────────────────────────────────────────────────

insert into research_notes (id, slug, title, body, published) values
('c0000001-0000-4000-8000-000000000001','reading-the-confidence-meter','How to read a Veritas confidence score',
 E'A confidence score in Veritas is **not** a vote on whether a claim is fashionable. It is a disciplined estimate, bounded by the claim''s epistemic status, of how strongly the *current* evidence supports it.\n\n## The bands\n\n- **0–20 — Unknown.** We genuinely cannot favor any answer. This is grey, not red: not knowing is a state of the map, not an error.\n- **0–40 — Speculation.** Coherent, sometimes beautiful, but weakly constrained by evidence.\n- **21–60 — Plausible.** Consistent with what we know; rivals remain credible.\n- **61–80 — Strong evidence.** Multiple independent lines converge.\n- **81–100 — Established.** Reversal would be revolutionary.\n\n## Why every number has a rationale\n\nThe database refuses to record a confidence change without a written rationale, and it keeps every previous value forever. So a score is always accompanied by *why*, and you can watch it move over time on the Timeline of Understanding.\n\nNotice that the deepest metaphysical hypotheses here sit low. That is honesty, not pessimism: we are charting how far from the shore each idea actually is.',
 true),
('c0000002-0000-4000-8000-000000000002','contradictions-are-features','Why we surface contradictions instead of hiding them',
 E'Most knowledge bases quietly pick a winner. Veritas does the opposite: when two hypotheses draw opposite conclusions from the *same* evidence, the system flags it as a contradiction and puts it in a review queue.\n\nThe dark-matter debate is the cleanest example shipped with V1.0. The Bullet Cluster supports a new-particle explanation and simultaneously *opposes* pure modified-gravity (MOND). The radial-acceleration relation does the reverse. Both relationships are recorded, so the contradiction engine can see the tension and a reader can weigh it directly on the evidence ledger.\n\nA contradiction is not an embarrassment to be resolved by fiat. It is a precise statement of where the map is still being drawn.',
 true),
('c0000003-0000-4000-8000-000000000003','what-veritas-is-not','What Veritas is not',
 E'Veritas is not an oracle, not a forecast market, and not a settled encyclopedia. It is an instrument for representing uncertainty honestly.\n\nIt will tell you, for any claim, what its epistemic status is, how confident the evidence makes us, what supports and opposes it, what it assumes, and what would prove it wrong. It will not pretend to certainty it does not have.\n\nThis draft note exists mainly to demonstrate the research-notes surface; treat its publication date as the moment the idea entered the map, not the moment it became true.',
 false)
on conflict (id) do nothing;

-- ─── Simulations (the five §2.5 categories) ──────────────────────────────────

insert into simulations (id, slug, category, title, description, status, parameters) values
('51a00001-0000-4000-8000-000000000001','primordial-soup-lab','artificial_ecosystems','Primordial Soup Lab',
 'A toy reaction-network model exploring how autocatalytic sets emerge under varying energy flux and molecular diversity. V1.0 records runs; execution arrives in V2.',
 'completed','{"max_species":120,"energy_flux":"variable","seed_chemistry":"CHON"}'),
('51a00002-0000-4000-8000-000000000002','emergent-agents','agent_intelligence','Emergent Agents',
 'Multi-agent reinforcement-learning sandbox studying when communication and cooperation emerge from sparse rewards.',
 'running','{"agents":64,"environment":"foraging","reward":"sparse"}'),
('51a00003-0000-4000-8000-000000000003','rise-and-fall','civilizations','Rise and Fall',
 'An agent-based civilization model tracking how resource limits and institutional trust drive collapse or resilience.',
 'planned','{"population":10000,"resources":"finite","shock_model":"poisson"}'),
('51a00004-0000-4000-8000-000000000004','toy-cosmos','universe_simulations','Toy Cosmos',
 'A parameter sweep over a simplified expansion model to visualize how the matter/dark-energy balance shapes cosmic fate.',
 'completed','{"omega_m":[0.2,0.3,0.4],"omega_lambda":[0.6,0.7,0.8]}'),
('51a00005-0000-4000-8000-000000000005','integration-probe','consciousness_experiments','Integration Probe',
 'A computational exploration of integrated-information (Φ) proxies across simple network topologies.',
 'planned','{"nodes":12,"topologies":["grid","small_world","modular"]}')
on conflict (id) do nothing;

insert into simulation_runs (id, simulation_id, parameters, results, metrics, started_at, finished_at) values
('51b00001-0000-4000-8000-000000000001','51a00001-0000-4000-8000-000000000001',
 '{"energy_flux":0.6}','{"autocatalytic_set_found":true,"closure_time":318}',
 '{"series":[{"t":0,"diversity":4},{"t":100,"diversity":21},{"t":200,"diversity":47},{"t":318,"diversity":63}]}',
 '2026-01-10T09:00:00Z','2026-01-10T09:42:00Z'),
('51b00002-0000-4000-8000-000000000002','51a00004-0000-4000-8000-000000000004',
 '{"omega_m":0.3,"omega_lambda":0.7}','{"fate":"heat_death","turnaround":false}',
 '{"series":[{"t":0,"scale_factor":1.0},{"t":5,"scale_factor":1.9},{"t":10,"scale_factor":3.8},{"t":15,"scale_factor":7.6}]}',
 '2026-02-02T12:00:00Z','2026-02-02T12:05:00Z'),
('51b00003-0000-4000-8000-000000000003','51a00002-0000-4000-8000-000000000002',
 '{"episode":1200}','{"communication_emerged":true,"cooperation_index":0.71}',
 '{"series":[{"t":0,"reward":0.1},{"t":400,"reward":0.3},{"t":800,"reward":0.55},{"t":1200,"reward":0.71}]}',
 '2026-03-15T08:00:00Z',null)
on conflict (id) do nothing;

commit;

-- ─── Populate the dashboard materialized view ────────────────────────────────
refresh materialized view dashboard_stats;

-- ─── Detect contradictions from the seeded evidence links ────────────────────
-- Idempotent; run after seeding so the review queue and flags are non-empty.
select scan_contradictions();
