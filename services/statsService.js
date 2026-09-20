import {
  User, Job, JobApplication, Course, BlogPost, Consultation, ContactMessage, FAQ,
} from '../models/index.js';

export async function getDashboardStats() {
  const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);

  const [
    totalUsers, totalEmployers, totalJobs, publishedJobs, totalApplications,
    totalCourses, totalPosts, newConsultations, totalConsultations, unreadMessages, totalFaqs,
  ] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    User.countDocuments({ role: 'employer' }),
    Job.countDocuments(),
    Job.countDocuments({ status: 'published' }),
    JobApplication.countDocuments(),
    Course.countDocuments({ status: 'published' }),
    BlogPost.countDocuments({ status: 'published' }),
    Consultation.countDocuments({ status: 'new' }),
    Consultation.countDocuments(),
    ContactMessage.countDocuments({ status: 'new' }),
    FAQ.countDocuments({ isPublished: true }),
  ]);

  const [consultationTrend, applicationsByStatus, topCategories] = await Promise.all([
    Consultation.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    JobApplication.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Job.aggregate([
      { $match: { status: 'published' } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]),
  ]);

  return {
    counts: {
      totalUsers, totalEmployers, totalJobs, publishedJobs, totalApplications,
      totalCourses, totalPosts, totalConsultations, newConsultations, unreadMessages, totalFaqs,
    },
    consultationTrend: consultationTrend.map((d) => ({ date: d._id, count: d.count })),
    applicationsByStatus: applicationsByStatus.map((d) => ({ status: d._id, count: d.count })),
    topCategories: topCategories.map((d) => ({ category: d._id, count: d.count })),
  };
}
