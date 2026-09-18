/**
 * CLI Simulation Script for API_Hashira ATS Engine
 * Run with: npx tsx scripts/simulate-ats.ts
 */

import { SAMPLE_JOB_DESCRIPTION, SAMPLE_RESUME_1, SAMPLE_RESUME_2 } from '../src/data/sampleData';

async function runCliSimulation() {
  console.log('\n======================================================');
  console.log('🤖 API_Hashira — Local CLI Evaluation Simulator');
  console.log('======================================================\n');

  console.log('📄 Target Job Description:');
  console.log('   Senior Full Stack Engineer (CloudScale Technologies)\n');

  console.log('📥 Loading Candidates:');
  console.log('   1. Alexander Rivera (Full Stack Lead)');
  console.log('   2. Priya Patel (Senior Frontend / UI Architect)\n');

  console.log('⚡ Evaluating 5-Factor Weighted Compatibility Matrix...');
  
  // Weights: Tech 40%, Exp 25%, Align 20%, Edu 10%, Format 5%
  const candidates = [
    {
      name: 'Alexander Rivera',
      tech: 38, // out of 40
      exp: 24,  // out of 25
      align: 19,// out of 20
      edu: 9,   // out of 10
      format: 4,// out of 5
    },
    {
      name: 'Priya Patel',
      tech: 26,
      exp: 18,
      align: 14,
      edu: 7,
      format: 3,
    },
  ];

  console.log('\n📊 EVALUATION RESULTS:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  candidates.forEach((c, idx) => {
    const totalScore = c.tech + c.exp + c.align + c.edu + c.format;
    const tier = totalScore >= 85 ? '🟢 EXCEPTIONAL FIT' : totalScore >= 70 ? '🟡 STRONG FIT' : '🔴 REJECT';
    
    console.log(`\nCandidate #${idx + 1}: ${c.name}`);
    console.log(`Score: ${totalScore}/100 [${tier}]`);
    console.log(`  • Technical Skills (40%):    ${c.tech}/40`);
    console.log(`  • Commercial Exp (25%):      ${c.exp}/25`);
    console.log(`  • Role Alignment (20%):      ${c.align}/20`);
    console.log(`  • Education & Certs (10%):   ${c.edu}/10`);
    console.log(`  • ATS Formatting (5%):       ${c.format}/5`);
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Simulation completed successfully.\n');
}

runCliSimulation().catch(console.error);
